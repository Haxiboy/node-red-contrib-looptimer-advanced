module.exports = function (RED) {
    "use strict";

    const UNIT_MS = {
        Millisecond: 1,
        Second: 1000,
        Minute: 60 * 1000,
        Hour: 60 * 60 * 1000,
        Day: 24 * 60 * 60 * 1000
    };
    const UNIT_LIST = Object.keys(UNIT_MS).join(", ");

    // Settings that can be a msg., flow., global. or env. value instead of a number (typed inputs).
    const TYPED_FIELDS = ["duration", "maxloops", "maxtimeout"];

    // setTimeout runs a delay above this after 1 ms (32-bit overflow), so longer waits are split into chunks.
    const MAX_DELAY = 2147483647;

    function toMs(unit, amount) {
        if (!Object.prototype.hasOwnProperty.call(UNIT_MS, unit)) {
            throw new Error(`Invalid unit: ${unit}`);
        }
        return UNIT_MS[unit] * amount;
    }

    function isCommand(value, word) {
        return typeof value === "string" && value.toLowerCase() === word;
    }

    function LoopTimer(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Which settings are not plain numbers, the value then is the name of the msg/flow/global/env property.
        const types = {};
        TYPED_FIELDS.forEach((field) => { types[field] = config[field + "Type"] || "num"; });
        const hasTyped = TYPED_FIELDS.some((field) => types[field] !== "num");

        node.units = config.units || "Second";
        // The loop interval has to be a finite number > 0, anything else falls back to the default
        const configDuration = Number(config.duration || 5);
        node.duration = types.duration === "num" && isFinite(configDuration) && configDuration > 0 ? configDuration : 5;
        node.maxloops = types.maxloops === "num" ? (config.maxloops || 100) : 100;
        node.maxtimeoutunits = config.maxtimeoutunits || "Hour";
        node.maxtimeout = types.maxtimeout === "num" ? (config.maxtimeout || 1) : 1;

        // Opt-in features. Flows saved by 0.0.x / 1.0.x do not carry these properties, so they keep the old behaviour.
        node.totalcount = config.totalcount === true || config.totalcount === "true";
        node.pausecontrol = config.pausecontrol === true || config.pausecontrol === "true";
        node.sendfirst = !(config.sendfirst === false || config.sendfirst === "false");
        node.addstate = config.addstate === true || config.addstate === "true";
        node.concurrency = config.concurrency === "ignore" || config.concurrency === "pertopic" ? config.concurrency : "restart";
        node.pausetimeout = Number(config.pausetimeout) > 0 ? Number(config.pausetimeout) : 0;
        node.pausetimeoutunits = Object.prototype.hasOwnProperty.call(UNIT_MS, config.pausetimeoutunits) ? config.pausetimeoutunits : "Minute";
        node.pauseaction = config.pauseaction === "stop" ? "stop" : "resume";

        if (node.maxtimeout <= 0) { node.maxtimeout = 0; }

        // Runtime state of the running loops: one per node, or one per msg.topic in "pertopic" mode.
        const runs = new Map();

        function keyOf(msg) {
            return node.concurrency === "pertopic" ? String(msg.topic) : "";
        }

        // In "pertopic" mode the status shows all loops, not the last event.
        function setStatus(fill, shape, text) {
            if (node.concurrency === "pertopic" && runs.size > 0) {
                let paused = 0;
                runs.forEach((r) => { if (r.paused) { paused++; } });
                const running = runs.size - paused;
                node.status({
                    fill: running > 0 ? "green" : "yellow",
                    shape: "dot",
                    text: paused > 0 ? `${running} running, ${paused} paused` : `${running} running`
                });
            } else {
                node.status({ fill: fill, shape: shape, text: text });
            }
        }

        // Calls fn at the absolute time due, also when that is more than MAX_DELAY away. The timer is run[prop].
        function armAt(run, prop, due, fn) {
            const left = due - Date.now();
            if (left > MAX_DELAY) {
                run[prop] = setTimeout(() => armAt(run, prop, due, fn), MAX_DELAY);
            } else {
                run[prop] = setTimeout(fn, Math.max(0, left));
            }
        }

        function clearTimers(run) {
            if (run.timer) { clearTimeout(run.timer); run.timer = null; }
            if (run.pauseTimer) { clearTimeout(run.pauseTimer); run.pauseTimer = null; }
        }

        function endLoop(run) {
            clearTimers(run);
            if (runs.get(run.key) === run) { runs.delete(run.key); }
        }

        // Counters of a loop, sent in msg.loopstate
        function stateOf(run, state) {
            const now = run.paused ? run.pausedAt : Date.now();
            return {
                state: state || (run.paused ? "paused" : "running"),
                count: run.count,
                sent: run.sent,
                max: run.limit > 0 ? run.limit : null,
                remaining: run.limit > 0 ? Math.max(0, run.limit - run.count) : null,
                elapsed: now - run.t0,
                interval: run.duration
            };
        }

        // Copy of the message of the loop, with the loop counters when they are switched on
        function copyOf(run, state) {
            const m = RED.util.cloneMessage(run.msg);
            if (run.addstate) { m.loopstate = stateOf(run, state); }
            return m;
        }

        // Status message for the second output. Based on the message of the loop, or on the incoming one when there is no loop.
        function controlMsg(base, payload, run, state, reason) {
            const m = RED.util.cloneMessage(base);
            m.payload = payload;
            if (run && run.addstate) { m.loopstate = stateOf(run, state); }
            if (reason) { m.reason = reason; }
            return m;
        }

        function sendControl(base, payload, run, state, reason) {
            node.send([null, controlMsg(base, payload, run, state, reason)]);
        }

        // Arms the single timer: either the next loop tick or, when it comes first, the overall timeout.
        // Every tick is due at a fixed time after the start, so the loop does not drift.
        function schedule(run) {
            const tickDue = run.origin + (run.count + 1) * run.duration;
            const deadline = run.t0 + run.maxtimeout;
            const deadlineFirst = deadline < tickDue;
            const due = deadlineFirst ? deadline : tickDue;
            armAt(run, "timer", due, deadlineFirst ? () => onDeadline(run) : () => onTick(run));
        }

        function onDeadline(run) {
            run.timer = null;
            // The loop is removed before the status is set, so in "pertopic" mode the count does not include it
            endLoop(run);
            setStatus("red", "ring", "timeout reached");
            sendControl(run.msg, "timeout", run, "finished");
        }

        function onTick(run) {
            run.timer = null;
            const now = Date.now();
            const lateness = now - (run.origin + (run.count + 1) * run.duration);
            run.count++;
            run.sent++;
            const count = run.count;
            // After a long stall (e.g. a blocked event loop) the loop carries on from now instead of firing a burst
            if (lateness > run.duration) { run.origin = now - count * run.duration; }

            const cp = copyOf(run);
            if (run.pausedFor) {
                cp.pauseduration = run.pausedFor;
                run.pausedFor = 0;
            }

            if (run.limit > 0 && count >= run.limit) {
                node.send([cp, controlMsg(run.msg, "max loops reached", run, "finished")]);
                endLoop(run);
                setStatus("red", "ring", "max loops reached");
                return;
            }

            if (count * run.duration <= run.maxtimeout) {
                node.send([cp, null]);
                if ((count + 1) * run.duration > run.maxtimeout) {
                    // Kept from 0.0.x: the last loop message is repeated together with the "timeout" message.
                    node.send([cp, controlMsg(run.msg, "timeout", run, "finished")]);
                    endLoop(run);
                    setStatus("red", "ring", "timeout reached");
                    return;
                }
                setStatus("green", "dot", "running");
                schedule(run);
            } else {
                endLoop(run);
                setStatus("red", "ring", "timeout reached");
                sendControl(run.msg, "timeout", run, "finished");
            }
        }

        function stop(msg, run, reason) {
            let state = null;
            if (run) {
                state = stateOf(run, "stopped");
                endLoop(run);
            }
            setStatus("red", "ring", "stopped");
            const m = controlMsg(msg, "stopped", null, null, reason);
            if (run && run.addstate) { m.loopstate = state; }
            node.send([null, m]);
        }

        function pause(run, msg) {
            if (run.paused) { return; }
            clearTimers(run);
            run.paused = true;
            run.pausedAt = Date.now();
            setStatus("yellow", "ring", "paused");
            sendControl(msg, "paused", run);
            if (node.pausetimeout > 0) {
                const wait = toMs(node.pausetimeoutunits, node.pausetimeout);
                const action = node.pauseaction;
                armAt(run, "pauseTimer", Date.now() + wait, () => {
                    run.pauseTimer = null;
                    if (action === "stop") { stop(run.msg, run, "pause timeout"); } else { resume(run, run.msg, "pause timeout"); }
                });
            }
        }

        function resume(run, msg, reason) {
            if (!run.paused) { return; }
            if (run.pauseTimer) { clearTimeout(run.pauseTimer); run.pauseTimer = null; }
            // The time spent paused does not count: the ticks and the timeout continue where they were left
            const spent = Date.now() - run.pausedAt;
            run.origin += spent;
            run.t0 += spent;
            run.pausedFor += spent;
            run.paused = false;
            setStatus("green", "dot", "running");
            sendControl(msg, "resumed", run, null, reason);
            schedule(run);
        }

        // Validates the msg.loop overrides and applies them only when all of them are valid.
        // Returns an error text, or null when everything is fine.
        function applyOverrides(over) {
            const pending = [];
            const checkUnit = (key, prop) => {
                if (over[key] === undefined) { return null; }
                if (!Object.prototype.hasOwnProperty.call(UNIT_MS, over[key])) {
                    node.status({ fill: "red", shape: "ring", text: `Invalid Attribute msg.loop.${key}` });
                    return `Invalid Attribute: msg.loop.${key}, allowed values are ${UNIT_LIST}`;
                }
                pending.push(() => { node[prop] = over[key]; });
                return null;
            };
            const checkNumber = (key, prop, positive) => {
                if (over[key] === undefined) { return null; }
                if (typeof over[key] !== "number" || !isFinite(over[key])) {
                    node.status({ fill: "red", shape: "ring", text: `msg.loop.${key} must be a number` });
                    return `Invalid Attribute: msg.loop.${key}, value must be a number`;
                }
                if (positive && over[key] <= 0) {
                    node.status({ fill: "red", shape: "ring", text: `msg.loop.${key} must be greater than 0` });
                    return `Invalid Attribute: msg.loop.${key}, value must be a positive number`;
                }
                pending.push(() => { node[prop] = over[key]; });
                return null;
            };
            const checkBoolean = (key, prop) => {
                if (over[key] === undefined) { return null; }
                if (typeof over[key] !== "boolean") {
                    node.status({ fill: "red", shape: "ring", text: `msg.loop.${key} must be a boolean` });
                    return `Invalid Attribute: msg.loop.${key}, value must be a boolean`;
                }
                pending.push(() => { node[prop] = over[key]; });
                return null;
            };
            const checkAction = () => {
                if (over.pauseaction === undefined) { return null; }
                if (over.pauseaction !== "resume" && over.pauseaction !== "stop") {
                    node.status({ fill: "red", shape: "ring", text: "Invalid Attribute msg.loop.pauseaction" });
                    return "Invalid Attribute: msg.loop.pauseaction, allowed values are resume and stop";
                }
                pending.push(() => { node.pauseaction = over.pauseaction; });
                return null;
            };
            const problem = checkBoolean("totalcount", "totalcount") ||
                checkUnit("units", "units") ||
                checkNumber("duration", "duration", true) ||
                checkUnit("maxtimeoutunits", "maxtimeoutunits") ||
                checkNumber("maxtimeout", "maxtimeout") ||
                checkNumber("maxloops", "maxloops") ||
                checkBoolean("sendfirst", "sendfirst") ||
                checkBoolean("loopstate", "addstate") ||
                checkNumber("pausetimeout", "pausetimeout") ||
                checkUnit("pausetimeoutunits", "pausetimeoutunits") ||
                checkAction();
            if (problem) { return problem; }
            pending.forEach((apply) => apply());
            return null;
        }

        function start(msg) {
            const key = keyOf(msg);
            const previous = runs.get(key);
            if (previous) { endLoop(previous); }

            const duration = toMs(node.units, node.duration);
            const maxtimeout = toMs(node.maxtimeoutunits, node.maxtimeout);
            const maxloops = Number(node.maxloops);

            // limit = number of loop messages after the first one; 0 means unlimited (until timeout or stop).
            let limit = maxloops;
            if (node.totalcount) {
                // totalcount: maxloops is the total number of messages, first one included; -1 = unlimited.
                limit = maxloops < 0 ? 0 : (node.sendfirst ? maxloops - 1 : maxloops);
                if (maxloops === 0) {
                    setStatus("red", "ring", "max loops reached");
                    sendControl(msg, "max loops reached");
                    return;
                }
                if (maxloops === 1 && node.sendfirst) {
                    node.send([RED.util.cloneMessage(msg), null]);
                    setStatus("red", "ring", "max loops reached");
                    sendControl(msg, "max loops reached");
                    return;
                }
            }

            const now = Date.now();
            const run = {
                key: key,
                msg: msg,
                duration: duration,
                maxtimeout: maxtimeout,
                limit: limit,
                addstate: node.addstate,
                count: 0,
                sent: 0,
                timer: null,
                pauseTimer: null,
                paused: false,
                pausedAt: 0,
                pausedFor: 0,
                origin: now, // the ticks are due at origin + n * duration
                t0: now // start of the loop, without the time spent paused; the timeout is counted from here
            };
            runs.set(key, run);
            if (node.sendfirst) {
                run.sent = 1;
                node.send([copyOf(run), null]);
            }
            setStatus("green", "dot", "running");
            schedule(run);
        }

        // Runs that a command is meant for: the one of this topic, or all of them with msg.loop.all
        function targets(msg, over) {
            if (over && over.all === true) { return Array.from(runs.values()); }
            const run = runs.get(keyOf(msg));
            return run ? [run] : [];
        }

        function reportStatus(msg, over) {
            const list = targets(msg, over);
            if (list.length === 0) {
                const m = RED.util.cloneMessage(msg);
                m.payload = "status";
                m.loopstate = { state: "idle" };
                node.send([null, m]);
                return;
            }
            list.forEach((run) => {
                const m = RED.util.cloneMessage(run.msg);
                m.payload = "status";
                m.loopstate = stateOf(run);
                node.send([null, m]);
            });
        }

        function loopOf(msg) {
            return msg.loop !== null && typeof msg.loop === "object" ? msg.loop : undefined;
        }

        // What a message asks for: start, stop, pause, resume or status
        function actionOf(msg) {
            const over = loopOf(msg);
            const command = over && typeof over.command === "string" ? over.command.toLowerCase() : null;
            const byPayload = (word) => node.pausecontrol && isCommand(msg.payload, word);

            let action = "start";
            if (command === "pause" || byPayload("pause")) {
                action = "pause";
            } else if (command === "resume" || byPayload("resume")) {
                action = "resume";
            } else if (command === "status" || byPayload("status")) {
                action = "status";
            } else if (command === "stop" || isCommand(msg.payload, "stop")) {
                action = "stop";
            }
            return action;
        }

        // While a loop runs the new messages are not wanted, not even their settings
        function isIgnored(msg, action) {
            return action === "start" && node.concurrency === "ignore" && runs.has(keyOf(msg));
        }

        function handle(msg, done) {
            const over = loopOf(msg);
            const action = actionOf(msg);

            if (isIgnored(msg, action)) {
                done();
                return;
            }

            if (over) {
                const problem = applyOverrides(over);
                if (problem) {
                    node.error(problem, msg);
                    done();
                    return;
                }
            }

            try {
                switch (action) {
                    case "pause":
                        targets(msg, over).forEach((run) => pause(run, msg));
                        break;
                    case "resume":
                        targets(msg, over).forEach((run) => resume(run, msg));
                        break;
                    case "status":
                        reportStatus(msg, over);
                        break;
                    case "stop": {
                        const list = targets(msg, over);
                        if (list.length === 0) {
                            stop(msg, null);
                        } else {
                            list.forEach((run) => stop(msg, run));
                        }
                        break;
                    }
                    default:
                        start(msg);
                }
                done();
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: err.message });
                done(err);
            }
        }

        // Reads the settings that are msg., flow., global. or env. values
        function resolveTyped(msg) {
            return Promise.all(TYPED_FIELDS.filter((field) => types[field] !== "num").map((field) => new Promise((resolve, reject) => {
                RED.util.evaluateNodeProperty(config[field], types[field], node, msg, (err, value) => {
                    const number = Number(value);
                    if (err || value === undefined || value === null || value === "" || !isFinite(number)) {
                        node.status({ fill: "red", shape: "ring", text: `${field} must be a number` });
                        reject(new Error(`Invalid value for ${field} (${types[field]}.${config[field]}), value must be a number`));
                        return;
                    }
                    if (field === "duration" && number <= 0) {
                        node.status({ fill: "red", shape: "ring", text: "duration must be greater than 0" });
                        reject(new Error(`Invalid value for ${field} (${types[field]}.${config[field]}), value must be a positive number`));
                        return;
                    }
                    node[field] = field === "maxtimeout" ? Math.max(number, 0) : number;
                    resolve();
                });
            })));
        }

        // Messages are handled one after the other, also when a setting has to be read from the context first
        let queue = Promise.resolve();

        node.on("input", function (msg, send, done) {
            done = done || function (err) { if (err) { node.error(err, msg); } };

            if (!hasTyped) {
                handle(msg, done);
                return;
            }
            // The settings are only read for a message that starts a loop, commands and ignored messages do not need them
            queue = queue
                .then(() => {
                    const action = actionOf(msg);
                    return action === "start" && !isIgnored(msg, action) ? resolveTyped(msg) : null;
                })
                .then(() => handle(msg, done), (err) => {
                    node.error(err.message, msg);
                    done();
                });
        });

        node.on("close", function () {
            runs.forEach((run) => clearTimers(run));
            runs.clear();
            node.status({});
        });
    }

    RED.nodes.registerType("looptimer-advanced", LoopTimer);
};
