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

        node.units = config.units || "Second";
        node.duration = config.duration || 5;
        node.maxloops = config.maxloops || 100;
        node.maxtimeoutunits = config.maxtimeoutunits || "Hour";
        node.maxtimeout = config.maxtimeout || 1;
        // Opt-in features. Flows saved by 0.0.x do not carry these properties, so they keep the old behaviour.
        node.totalcount = config.totalcount === true || config.totalcount === "true";
        node.pausecontrol = config.pausecontrol === true || config.pausecontrol === "true";

        if (node.duration <= 0) { node.duration = 0; }
        if (node.maxtimeout <= 0) { node.maxtimeout = 0; }

        // Runtime state of the running loop (null when idle).
        let run = null;

        function clearTimer() {
            if (run && run.timer) {
                clearTimeout(run.timer);
                run.timer = null;
            }
        }

        function endLoop() {
            clearTimer();
            run = null;
        }

        function sendControl(msg, payload) {
            const m = RED.util.cloneMessage(msg);
            m.payload = payload;
            node.send([null, m]);
        }

        // Arms the single timer: either the next loop tick or, when it comes first, the overall timeout.
        function schedule() {
            const now = Date.now();
            const untilTick = run.remainingTick !== null ? run.remainingTick : run.duration;
            const untilDeadline = run.remainingDeadline !== null ? run.remainingDeadline : run.deadline - now;
            run.remainingTick = null;
            run.remainingDeadline = null;

            const deadlineFirst = untilDeadline < untilTick;
            const delay = Math.max(0, Math.min(untilTick, untilDeadline));
            run.tickDue = now + (deadlineFirst ? untilTick : delay);
            run.deadline = now + untilDeadline;
            run.timer = setTimeout(deadlineFirst ? onDeadline : onTick, delay);
        }

        function onDeadline() {
            run.timer = null;
            node.status({ fill: "red", shape: "ring", text: "timeout reached" });
            sendControl(run.msg, "timeout");
            endLoop();
        }

        function onTick() {
            run.timer = null;
            run.count++;
            const count = run.count;
            const cp = RED.util.cloneMessage(run.msg);
            if (run.pausedFor) {
                cp.pauseduration = run.pausedFor;
                run.pausedFor = 0;
            }

            if (run.limit > 0 && count >= run.limit) {
                const ml = RED.util.cloneMessage(run.msg);
                ml.payload = "max loops reached";
                node.send([cp, ml]);
                node.status({ fill: "red", shape: "ring", text: "max loops reached" });
                endLoop();
                return;
            }

            if (count * run.duration <= run.maxtimeout) {
                node.send([cp, null]);
                if ((count + 1) * run.duration > run.maxtimeout) {
                    // Kept from 0.0.x: the last loop message is repeated together with the "timeout" message.
                    const to = RED.util.cloneMessage(run.msg);
                    to.payload = "timeout";
                    node.send([cp, to]);
                    node.status({ fill: "red", shape: "ring", text: "timeout reached" });
                    endLoop();
                    return;
                }
                node.status({ fill: "green", shape: "dot", text: "running" });
                schedule();
            } else {
                node.status({ fill: "red", shape: "ring", text: "timeout reached" });
                sendControl(run.msg, "timeout");
                endLoop();
            }
        }

        function stop(msg) {
            endLoop();
            node.status({ fill: "red", shape: "ring", text: "stopped" });
            sendControl(msg, "stopped");
        }

        function pause(msg) {
            if (!run || run.paused) { return; }
            const now = Date.now();
            clearTimer();
            run.paused = true;
            run.pausedAt = now;
            run.remainingTick = Math.max(0, run.tickDue - now);
            run.remainingDeadline = Math.max(0, run.deadline - now);
            node.status({ fill: "yellow", shape: "ring", text: "paused" });
            sendControl(msg, "paused");
        }

        function resume(msg) {
            if (!run || !run.paused) { return; }
            run.paused = false;
            run.pausedFor = (run.pausedFor || 0) + (Date.now() - run.pausedAt);
            node.status({ fill: "green", shape: "dot", text: "running" });
            sendControl(msg, "resumed");
            schedule();
        }

        // Validates and applies msg.loop overrides. Returns an error text, or null when everything is fine.
        function applyOverrides(over) {
            const checkUnit = (key, prop) => {
                if (over[key] === undefined) { return null; }
                if (!Object.prototype.hasOwnProperty.call(UNIT_MS, over[key])) {
                    node.status({ fill: "red", shape: "ring", text: `Invalid Attribute msg.loop.${key}` });
                    return `Invalid Attribute: msg.loop.${key}, allowed values are ${UNIT_LIST}`;
                }
                node[prop] = over[key];
                return null;
            };
            const checkNumber = (key, prop) => {
                if (over[key] === undefined) { return null; }
                if (typeof over[key] !== "number" || isNaN(over[key])) {
                    node.status({ fill: "red", shape: "ring", text: `msg.loop.${key} must be a number` });
                    return `Invalid Attribute: msg.loop.${key}, value must be a number`;
                }
                node[prop] = over[key];
                return null;
            };
            if (over.totalcount !== undefined) {
                if (typeof over.totalcount !== "boolean") {
                    node.status({ fill: "red", shape: "ring", text: "msg.loop.totalcount must be a boolean" });
                    return "Invalid Attribute: msg.loop.totalcount, value must be a boolean";
                }
                node.totalcount = over.totalcount;
            }
            return checkUnit("units", "units") ||
                checkNumber("duration", "duration") ||
                checkUnit("maxtimeoutunits", "maxtimeoutunits") ||
                checkNumber("maxtimeout", "maxtimeout") ||
                checkNumber("maxloops", "maxloops");
        }

        function start(msg) {
            endLoop();
            const duration = toMs(node.units, node.duration);
            const maxtimeout = toMs(node.maxtimeoutunits, node.maxtimeout);
            const maxloops = Number(node.maxloops);

            // limit = number of loop messages after the first one; 0 means unlimited (until timeout or stop).
            let limit = maxloops;
            if (node.totalcount) {
                // totalcount: maxloops is the total number of messages, first one included; -1 = unlimited.
                limit = maxloops < 0 ? 0 : maxloops - 1;
                if (maxloops === 0) {
                    node.status({ fill: "red", shape: "ring", text: "max loops reached" });
                    sendControl(msg, "max loops reached");
                    return;
                }
                if (maxloops === 1) {
                    node.send([RED.util.cloneMessage(msg), null]);
                    node.status({ fill: "red", shape: "ring", text: "max loops reached" });
                    sendControl(msg, "max loops reached");
                    return;
                }
            }

            node.send([RED.util.cloneMessage(msg), null]);
            run = {
                msg: msg,
                duration: duration,
                maxtimeout: maxtimeout,
                limit: limit,
                count: 0,
                timer: null,
                paused: false,
                pausedAt: 0,
                pausedFor: 0,
                tickDue: 0,
                deadline: Date.now() + maxtimeout,
                remainingTick: null,
                remainingDeadline: null
            };
            node.status({ fill: "green", shape: "dot", text: "running" });
            schedule();
        }

        node.on("input", function (msg, send, done) {
            done = done || function (err) { if (err) { node.error(err, msg); } };

            const over = msg.loop;
            if (over !== undefined && over !== null && typeof over === "object") {
                const problem = applyOverrides(over);
                if (problem) {
                    node.error(problem, msg);
                    done();
                    return;
                }
            }

            const command = over && typeof over.command === "string" ? over.command.toLowerCase() : null;
            const byPayload = (word) => node.pausecontrol && isCommand(msg.payload, word);

            try {
                if (command === "pause" || byPayload("pause")) {
                    pause(msg);
                } else if (command === "resume" || byPayload("resume")) {
                    resume(msg);
                } else if (command === "stop" || isCommand(msg.payload, "stop")) {
                    stop(msg);
                } else {
                    start(msg);
                }
                done();
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: err.message });
                done(err);
            }
        });

        node.on("close", function () {
            endLoop();
            node.status({});
        });
    }

    RED.nodes.registerType("looptimer-advanced", LoopTimer);
};
