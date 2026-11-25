"use strict";
const helper = require("node-red-node-test-helper");
const should = require("should");
const node = require("../looptimer_advanced.js");

helper.init(require.resolve("node-red"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tests of the 1.1.0 features. Everything is off by default, the 0.0.x / 1.0.x behaviour is covered in looptimer_advanced.test.js.
describe("looptimer-advanced 1.1.0", function () {
    this.timeout(8000);

    beforeEach(() => helper.startServer());
    afterEach(async () => {
        await helper.unload();
        await helper.stopServer();
    });

    function setup(cfg, cb) {
        const flow = [
            Object.assign({ id: "n1", type: "looptimer-advanced", name: "t", z: "f1", wires: [["out"], ["ctl"]] }, cfg),
            { id: "out", type: "helper" },
            { id: "ctl", type: "helper" },
            { id: "f1", type: "tab" }
        ];
        return new Promise((resolve, reject) => {
            helper.load(node, flow, () => {
                const n1 = helper.getNode("n1");
                const got = { out: [], ctl: [], errors: [] };
                helper.getNode("out").on("input", (m) => got.out.push(m));
                helper.getNode("ctl").on("input", (m) => got.ctl.push(m));
                n1.error = (e) => got.errors.push(e);
                Promise.resolve(cb(n1, got)).then(resolve, reject);
            });
        });
    }

    const payloads = (list) => list.map((m) => m.payload);

    describe("send the first message", function () {
        it("sendfirst: false waits one interval for the first message", function () {
            return setup({ duration: "100", units: "Millisecond", maxloops: "2", sendfirst: false }, async (n1, got) => {
                n1.receive({ payload: "go" });
                await sleep(40);
                got.out.length.should.equal(0);
                await sleep(500);
                got.out.length.should.equal(2);
                payloads(got.ctl).should.eql(["max loops reached"]);
            });
        });

        it("is on by default, a message of an older flow still goes out immediately", function () {
            return setup({ duration: "100", units: "Millisecond", maxloops: "1" }, async (n1, got) => {
                n1.receive({ payload: "go" });
                await sleep(40);
                got.out.length.should.equal(1);
            });
        });

        it("with totalcount the number of messages is exact, also without the first one", function () {
            return setup({ duration: "30", units: "Millisecond", maxloops: "3", totalcount: true, sendfirst: false }, async (n1, got) => {
                n1.receive({ payload: "go" });
                await sleep(400);
                got.out.length.should.equal(3);
                payloads(got.ctl).should.eql(["max loops reached"]);
            });
        });

        it("can be switched per message with msg.loop.sendfirst", function () {
            return setup({ duration: "100", units: "Millisecond", maxloops: "1" }, async (n1, got) => {
                n1.receive({ payload: "go", loop: { sendfirst: false } });
                await sleep(40);
                got.out.length.should.equal(0);
                await sleep(300);
                got.out.length.should.equal(1);
            });
        });
    });

    describe("msg.loopstate", function () {
        it("is not added by default", function () {
            return setup({ duration: "20", units: "Millisecond", maxloops: "2" }, async (n1, got) => {
                n1.receive({ payload: "go" });
                await sleep(200);
                got.out.forEach((m) => should(m.loopstate).be.undefined());
                got.ctl.forEach((m) => should(m.loopstate).be.undefined());
            });
        });

        it("carries the counters of the loop", function () {
            return setup({ duration: "30", units: "Millisecond", maxloops: "3", addstate: true }, async (n1, got) => {
                n1.receive({ payload: "go" });
                await sleep(400);
                got.out.map((m) => m.loopstate.count).should.eql([0, 1, 2, 3]);
                got.out.map((m) => m.loopstate.sent).should.eql([1, 2, 3, 4]);
                got.out.map((m) => m.loopstate.remaining).should.eql([3, 2, 1, 0]);
                got.out[1].loopstate.should.have.properties({ state: "running", max: 3, interval: 30 });
                got.out[3].loopstate.elapsed.should.be.within(60, 250);
                got.ctl[0].payload.should.equal("max loops reached");
                got.ctl[0].loopstate.state.should.equal("finished");
            });
        });

        it("can be switched per message with msg.loop.loopstate", function () {
            return setup({ duration: "20", units: "Millisecond", maxloops: "1" }, async (n1, got) => {
                n1.receive({ payload: "go", loop: { loopstate: true } });
                await sleep(200);
                got.out[0].loopstate.state.should.equal("running");
            });
        });
    });

    describe("new messages while a loop is running", function () {
        it("ignore: the loop is not restarted and the new message is dropped", function () {
            return setup({ duration: "60", units: "Millisecond", maxloops: "3", concurrency: "ignore" }, async (n1, got) => {
                n1.receive({ payload: "a", topic: "a" });
                await sleep(80);
                n1.receive({ payload: "b", topic: "b", loop: { maxloops: 50 } });
                await sleep(500);
                got.out.map((m) => m.topic).should.eql(["a", "a", "a", "a"]);
                // the settings of the dropped message were not applied either
                n1.maxloops.should.equal("3");
            });
        });

        it("ignore: stop still works, and a new message starts a loop afterwards", function () {
            return setup({ duration: "60", units: "Millisecond", maxloops: "50", concurrency: "ignore" }, async (n1, got) => {
                n1.receive({ payload: "a", topic: "a" });
                await sleep(100);
                n1.receive({ payload: "stop" });
                await sleep(20);
                payloads(got.ctl).should.eql(["stopped"]);
                n1.receive({ payload: "b", topic: "b" });
                await sleep(100);
                got.out.some((m) => m.topic === "b").should.equal(true);
                n1.receive({ payload: "stop" });
            });
        });

        it("pertopic: every topic has its own loop", function () {
            return setup({ duration: "40", units: "Millisecond", maxloops: "3", concurrency: "pertopic" }, async (n1, got) => {
                n1.receive({ payload: "x", topic: "a" });
                await sleep(20);
                n1.receive({ payload: "x", topic: "b" });
                await sleep(500);
                got.out.filter((m) => m.topic === "a").length.should.equal(4);
                got.out.filter((m) => m.topic === "b").length.should.equal(4);
                got.ctl.map((m) => m.topic).sort().should.eql(["a", "b"]);
            });
        });

        it("pertopic: a new message of a topic restarts only that loop", function () {
            return setup({ duration: "60", units: "Millisecond", maxloops: "2", concurrency: "pertopic" }, async (n1, got) => {
                n1.receive({ payload: "x", topic: "a" });
                n1.receive({ payload: "x", topic: "b" });
                await sleep(80);
                n1.receive({ payload: "x", topic: "a" });
                await sleep(500);
                // a: 2 + restart (1 + 2) = 5, b: 3
                got.out.filter((m) => m.topic === "a").length.should.equal(5);
                got.out.filter((m) => m.topic === "b").length.should.equal(3);
            });
        });

        it("pertopic: stop, pause and resume act on the loop of the topic, msg.loop.all on all of them", function () {
            return setup({ duration: "50", units: "Millisecond", maxloops: "100", concurrency: "pertopic", pausecontrol: true }, async (n1, got) => {
                n1.receive({ payload: "x", topic: "a" });
                n1.receive({ payload: "x", topic: "b" });
                await sleep(130);
                n1.receive({ payload: "stop", topic: "a" });
                await sleep(20);
                const aCount = got.out.filter((m) => m.topic === "a").length;
                const bCount = got.out.filter((m) => m.topic === "b").length;
                await sleep(200);
                got.out.filter((m) => m.topic === "a").length.should.equal(aCount);
                got.out.filter((m) => m.topic === "b").length.should.be.above(bCount);

                n1.receive({ payload: "pause", topic: "b" });
                await sleep(20);
                const frozen = got.out.length;
                await sleep(200);
                got.out.length.should.equal(frozen);
                n1.receive({ payload: "resume", topic: "b" });
                await sleep(150);
                got.out.length.should.be.above(frozen);

                got.ctl.length = 0;
                n1.receive({ payload: "x", topic: "c" });
                n1.receive({ payload: "stop", loop: { all: true } });
                await sleep(30);
                got.ctl.map((m) => m.payload).should.eql(["stopped", "stopped"]);
                const total = got.out.length;
                await sleep(200);
                got.out.length.should.equal(total);
            });
        });

        it("pertopic: the status shows all loops", function () {
            return setup({ duration: "100", units: "Millisecond", maxloops: "100", concurrency: "pertopic" }, async (n1) => {
                let last = null;
                n1.status = (s) => { last = s; };
                n1.receive({ payload: "x", topic: "a" });
                n1.receive({ payload: "x", topic: "b" });
                last.text.should.equal("2 running");
                n1.receive({ payload: "stop", loop: { all: true } });
            });
        });

        it("pertopic: a finished loop is no longer counted in the status", function () {
            return setup({ duration: "40", units: "Millisecond", concurrency: "pertopic" }, async (n1, got) => {
                let last = null;
                n1.status = (s) => { last = s; };
                // b ticks only much later, so the status after a ends comes from the end of a alone
                n1.receive({ payload: "x", topic: "a", loop: { duration: 30, maxloops: 1 } });
                n1.receive({ payload: "x", topic: "b", loop: { duration: 2000, maxloops: 100 } });
                last.text.should.equal("2 running");
                await sleep(120);
                payloads(got.ctl).should.eql(["max loops reached"]);
                last.text.should.equal("1 running");
                n1.receive({ payload: "stop", loop: { all: true } });
            });
        });
    });

    describe("status command", function () {
        it("reports the state of the loop through payload when payload commands are on", function () {
            return setup({ duration: "50", units: "Millisecond", maxloops: "10", pausecontrol: true }, async (n1, got) => {
                n1.receive({ payload: "status" });
                await sleep(20);
                got.ctl[0].payload.should.equal("status");
                got.ctl[0].loopstate.should.eql({ state: "idle" });
                got.out.length.should.equal(0);

                n1.receive({ payload: "go" });
                await sleep(130);
                n1.receive({ payload: "status" });
                await sleep(20);
                const state = got.ctl[1].loopstate;
                state.state.should.equal("running");
                state.count.should.be.within(1, 3);
                state.max.should.equal(10);
                n1.receive({ payload: "pause" });
                n1.receive({ payload: "status" });
                await sleep(20);
                got.ctl[got.ctl.length - 1].loopstate.state.should.equal("paused");
                n1.receive({ payload: "stop" });
            });
        });

        it("is a loop message like any other when payload commands are off", function () {
            return setup({ duration: "50", units: "Millisecond", maxloops: "1" }, async (n1, got) => {
                n1.receive({ payload: "status" });
                await sleep(200);
                payloads(got.out).should.eql(["status", "status"]);
            });
        });

        it("msg.loop.command works without payload commands", function () {
            return setup({ duration: "50", units: "Millisecond", maxloops: "10" }, async (n1, got) => {
                n1.receive({ payload: "go" });
                n1.receive({ payload: "x", loop: { command: "status" } });
                await sleep(20);
                got.ctl[0].loopstate.state.should.equal("running");
                n1.receive({ payload: "stop" });
            });
        });
    });

    describe("pause timeout", function () {
        it("resumes automatically", function () {
            return setup({ duration: "60", units: "Millisecond", maxloops: "3", pausetimeout: "150", pausetimeoutunits: "Millisecond", pausecontrol: true }, async (n1, got) => {
                n1.receive({ payload: "go" });
                await sleep(30);
                n1.receive({ payload: "pause" });
                await sleep(100);
                got.out.length.should.equal(1);
                await sleep(500);
                got.out.length.should.equal(4);
                got.ctl.map((m) => m.payload).should.eql(["paused", "resumed", "max loops reached"]);
                got.ctl[1].reason.should.equal("pause timeout");
            });
        });

        it("can stop the loop instead", function () {
            return setup({ duration: "60", units: "Millisecond", maxloops: "50", pausetimeout: "100", pausetimeoutunits: "Millisecond", pauseaction: "stop", pausecontrol: true }, async (n1, got) => {
                n1.receive({ payload: "go" });
                await sleep(30);
                n1.receive({ payload: "pause" });
                await sleep(300);
                got.ctl.map((m) => m.payload).should.eql(["paused", "stopped"]);
                got.ctl[1].reason.should.equal("pause timeout");
                const count = got.out.length;
                await sleep(200);
                got.out.length.should.equal(count);
            });
        });

        it("is cancelled by resume and by stop", function () {
            return setup({ duration: "60", units: "Millisecond", maxloops: "50", pausetimeout: "150", pausetimeoutunits: "Millisecond", pauseaction: "stop", pausecontrol: true }, async (n1, got) => {
                n1.receive({ payload: "go" });
                n1.receive({ payload: "pause" });
                await sleep(50);
                n1.receive({ payload: "resume" });
                await sleep(400);
                // still running, the pause timeout did not stop it
                got.ctl.map((m) => m.payload).should.eql(["paused", "resumed"]);
                n1.receive({ payload: "stop" });
            });
        });

        it("can be set per message", function () {
            return setup({ duration: "60", units: "Millisecond", maxloops: "50", pausecontrol: true }, async (n1, got) => {
                n1.receive({ payload: "go" });
                n1.receive({ payload: "pause", loop: { pausetimeout: 80, pausetimeoutunits: "Millisecond", pauseaction: "stop" } });
                await sleep(250);
                got.ctl.map((m) => m.payload).should.eql(["paused", "stopped"]);
            });
        });
    });

    describe("timing", function () {
        it("does not drift: 30 ticks of 30 ms take about 900 ms", function () {
            return setup({ duration: "30", units: "Millisecond", maxloops: "30" }, async (n1, got) => {
                const started = Date.now();
                n1.receive({ payload: "go" });
                await new Promise((resolve) => {
                    const check = setInterval(() => { if (got.ctl.length) { clearInterval(check); resolve(); } }, 10);
                });
                const took = Date.now() - started;
                took.should.be.within(850, 1300);
            });
        });

        it("keeps the schedule across a pause", function () {
            return setup({ duration: "100", units: "Millisecond", maxloops: "3", pausecontrol: true }, async (n1, got) => {
                const started = Date.now();
                n1.receive({ payload: "go" });
                await sleep(50);
                n1.receive({ payload: "pause" });
                await sleep(300);
                n1.receive({ payload: "resume" });
                await new Promise((resolve) => {
                    const check = setInterval(() => { if (got.ctl.some((m) => m.payload === "max loops reached")) { clearInterval(check); resolve(); } }, 10);
                });
                // 300 ms of loop time plus the 300 ms pause
                (Date.now() - started).should.be.within(550, 900);
            });
        });
    });

    describe("typed inputs", function () {
        it("reads the interval and the limits from the message", function () {
            return setup({ duration: "interval", durationType: "msg", maxloops: "limit", maxloopsType: "msg", units: "Millisecond" }, async (n1, got) => {
                n1.receive({ payload: "go", interval: 30, limit: 2 });
                await sleep(300);
                got.out.length.should.equal(3);
                payloads(got.ctl).should.eql(["max loops reached"]);
            });
        });

        it("reads the settings from the flow context", function () {
            return setup({ duration: "iv", durationType: "flow", maxloops: "2", units: "Millisecond" }, async (n1, got) => {
                n1.context().flow.set("iv", 40);
                n1.receive({ payload: "go" });
                await sleep(300);
                got.out.length.should.equal(3);
            });
        });

        it("reads the max timeout from an env variable", function () {
            process.env.LOOPTIMER_TEST_TIMEOUT = "100";
            return setup({ duration: "30", units: "Millisecond", maxtimeout: "LOOPTIMER_TEST_TIMEOUT", maxtimeoutType: "env", maxtimeoutunits: "Millisecond", maxloops: "1000" }, async (n1, got) => {
                n1.receive({ payload: "go" });
                await sleep(400);
                payloads(got.ctl).should.eql(["timeout"]);
            });
        });

        it("rejects a value that is not a number and does not start a loop", function () {
            return setup({ duration: "interval", durationType: "msg", units: "Millisecond" }, async (n1, got) => {
                n1.receive({ payload: "go", interval: "abc" });
                n1.receive({ payload: "go" });
                await sleep(100);
                got.errors.length.should.equal(2);
                got.out.length.should.equal(0);
            });
        });

        it("keeps the order of the messages, a stop right after a start works", function () {
            return setup({ duration: "d", durationType: "msg", maxloops: "100", units: "Millisecond" }, async (n1, got) => {
                n1.receive({ payload: "go", d: 50 });
                n1.receive({ payload: "stop" });
                await sleep(300);
                got.out.length.should.equal(1);
                got.errors.length.should.equal(0);
                payloads(got.ctl).should.eql(["stopped"]);
            });
        });

        it("a stop without the typed property stops the running loop", function () {
            return setup({ duration: "d", durationType: "msg", maxloops: "100", units: "Millisecond" }, async (n1, got) => {
                n1.receive({ payload: "go", d: 30 });
                await sleep(100);
                n1.receive({ payload: "stop" });
                await sleep(50);
                const sent = got.out.length;
                sent.should.be.above(1);
                got.errors.length.should.equal(0);
                payloads(got.ctl).should.eql(["stopped"]);
                await sleep(150);
                got.out.length.should.equal(sent);
            });
        });

        it("pause, resume and status commands do not need the typed property", function () {
            return setup({ duration: "d", durationType: "msg", maxloops: "100", units: "Millisecond", pausecontrol: true }, async (n1, got) => {
                n1.receive({ payload: "go", d: 30 });
                n1.receive({ payload: "status" });
                n1.receive({ payload: "pause" });
                n1.receive({ payload: "resume" });
                n1.receive({ payload: "go", loop: { command: "stop" } });
                await sleep(100);
                got.errors.length.should.equal(0);
                payloads(got.ctl).should.eql(["status", "paused", "resumed", "stopped"]);
            });
        });

        it("a message that is ignored while a loop runs does not read the typed settings", function () {
            return setup({ duration: "d", durationType: "msg", maxloops: "100", units: "Millisecond", concurrency: "ignore" }, async (n1, got) => {
                n1.receive({ payload: "go", d: 30 });
                n1.receive({ payload: "again" });
                await sleep(50);
                got.errors.length.should.equal(0);
                n1.receive({ payload: "stop" });
            });
        });

        it("rejects an interval of 0 or less and does not start a loop", function () {
            return setup({ duration: "d", durationType: "msg", units: "Millisecond" }, async (n1, got) => {
                n1.receive({ payload: "go", d: 0 });
                n1.receive({ payload: "go", d: -5 });
                await sleep(100);
                got.errors.length.should.equal(2);
                got.out.length.should.equal(0);
            });
        });
    });

    describe("msg.loop validation", function () {
        it("rejects an interval of 0, a negative one and Infinity, nothing is sent", function () {
            return setup({ duration: "20", units: "Millisecond" }, async (n1, got) => {
                n1.receive({ payload: "go", loop: { duration: 0 } });
                n1.receive({ payload: "go", loop: { duration: -1 } });
                n1.receive({ payload: "go", loop: { duration: Infinity } });
                n1.receive({ payload: "go", loop: { duration: NaN } });
                await sleep(100);
                got.errors.length.should.equal(4);
                got.out.length.should.equal(0);
            });
        });

        it("rejects Infinity in the other numeric overrides", function () {
            return setup({ duration: "20", units: "Millisecond" }, async (n1, got) => {
                n1.receive({ payload: "go", loop: { maxtimeout: Infinity } });
                n1.receive({ payload: "go", loop: { maxloops: Infinity } });
                n1.receive({ payload: "go", loop: { pausetimeout: Infinity } });
                got.errors.length.should.equal(3);
                got.out.length.should.equal(0);
            });
        });

        it("still accepts maxtimeout 0", function () {
            return setup({ duration: "20", units: "Millisecond", maxloops: "5" }, async (n1, got) => {
                n1.receive({ payload: "go", loop: { maxtimeout: 0 } });
                await sleep(100);
                got.errors.length.should.equal(0);
                got.out.length.should.equal(1);
                payloads(got.ctl).should.eql(["timeout"]);
            });
        });

        it("an invalid override changes nothing, the previous settings stay in effect", function () {
            return setup({ duration: "30", units: "Millisecond", maxloops: "2" }, async (n1, got) => {
                n1.receive({ payload: "go", loop: { units: "Hour", duration: "abc" } });
                got.errors.length.should.equal(1);
                n1.units.should.equal("Millisecond");
                n1.receive({ payload: "go" });
                await sleep(300);
                got.out.length.should.equal(3);
                payloads(got.ctl).should.eql(["max loops reached"]);
            });
        });

        it("rejects invalid values of the new properties", function () {
            return setup({ duration: "20", units: "Millisecond" }, async (n1, got) => {
                n1.receive({ payload: "go", loop: { sendfirst: "yes" } });
                n1.receive({ payload: "go", loop: { loopstate: 1 } });
                n1.receive({ payload: "go", loop: { pausetimeout: "5" } });
                n1.receive({ payload: "go", loop: { pausetimeoutunits: "Fortnight" } });
                n1.receive({ payload: "go", loop: { pauseaction: "explode" } });
                got.errors.length.should.equal(5);
                got.out.length.should.equal(0);
            });
        });
    });

    describe("long timers", function () {
        // Node runs a setTimeout above 2^31-1 ms after 1 ms, so these must not fire early
        it("an interval of 30 days does not tick right away", function () {
            return setup({ duration: "30", units: "Day", maxtimeout: "100", maxtimeoutunits: "Day", maxloops: "5", sendfirst: false }, async (n1, got) => {
                n1.receive({ payload: "go" });
                await sleep(150);
                got.out.length.should.equal(0);
                got.ctl.length.should.equal(0);
                n1.receive({ payload: "stop" });
                await sleep(20);
                payloads(got.ctl).should.eql(["stopped"]);
            });
        });

        it("a max timeout of 30 days does not fire right away", function () {
            return setup({ duration: "20", units: "Millisecond", maxtimeout: "30", maxtimeoutunits: "Day", maxloops: "3" }, async (n1, got) => {
                n1.receive({ payload: "go" });
                await sleep(300);
                got.out.length.should.equal(4);
                payloads(got.ctl).should.eql(["max loops reached"]);
            });
        });

        it("a pause timeout of 30 days does not fire right away", function () {
            return setup({ duration: "20", units: "Millisecond", maxloops: "100", pausecontrol: true, pausetimeout: "30", pausetimeoutunits: "Day", pauseaction: "stop" }, async (n1, got) => {
                n1.receive({ payload: "go" });
                n1.receive({ payload: "pause" });
                await sleep(150);
                payloads(got.ctl).should.eql(["paused"]);
                n1.receive({ payload: "stop" });
                await sleep(20);
                payloads(got.ctl).should.eql(["paused", "stopped"]);
            });
        });
    });
});
