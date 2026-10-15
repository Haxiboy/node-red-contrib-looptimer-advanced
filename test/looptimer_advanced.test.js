"use strict";
const helper = require("node-red-node-test-helper");
const should = require("should");
const node = require("../looptimer_advanced.js");

helper.init(require.resolve("node-red"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Characterization tests: they pin down the behaviour of the 0.0.x series.
describe("looptimer-advanced", function () {
    this.timeout(5000);

    beforeEach(() => helper.startServer());
    afterEach(async () => {
        await helper.unload();
        await helper.stopServer();
    });

    function setup(cfg, cb) {
        return new Promise((resolve, reject) => {
            setup_(cfg, (n1, got) => {
                Promise.resolve(cb(n1, got)).then(resolve, reject);
            });
        });
    }

    function setup_(cfg, cb) {
        const flow = [
            Object.assign({ id: "n1", type: "looptimer-advanced", name: "t", wires: [["out"], ["ctl"]] }, cfg),
            { id: "out", type: "helper" },
            { id: "ctl", type: "helper" }
        ];
        return helper.load(node, flow, () => {
            const n1 = helper.getNode("n1");
            const out = helper.getNode("out");
            const ctl = helper.getNode("ctl");
            const got = { out: [], ctl: [] };
            out.on("input", (m) => got.out.push(m));
            ctl.on("input", (m) => got.ctl.push(m));
            cb(n1, got);
        });
    }

    it("loads with defaults", function () {
        return setup({}, (n1) => {
            n1.should.have.property("name", "t");
            n1.should.have.property("units", "Second");
            n1.should.have.property("duration", 5);
            n1.should.have.property("maxloops", 100);
        });
    });

    it("sends the original msg immediately, then maxloops more, then 'max loops reached'", function () {
        return setup({ duration: "20", units: "Millisecond", maxloops: "3", maxtimeout: "1", maxtimeoutunits: "Hour" }, async (n1, got) => {
            n1.receive({ payload: "go", topic: "x" });
            await sleep(5);
            should(got.out.length).equal(1); // first msg is sent right away
            await sleep(300);
            got.out.length.should.equal(4); // 1 original + 3 loops
            got.out.forEach((m) => { m.payload.should.equal("go"); m.topic.should.equal("x"); });
            got.ctl.length.should.equal(1);
            got.ctl[0].payload.should.equal("max loops reached");
            await sleep(100);
            got.out.length.should.equal(4); // loop really ended
        });
    });

    it("stops on payload 'stop' (any case) and reports 'stopped' on output 2", function () {
        return setup({ duration: "100", units: "Millisecond", maxloops: "100" }, async (n1, got) => {
            n1.receive({ payload: "go" });
            await sleep(250); // stop while a timer is clearly pending
            n1.receive({ payload: "STOP" });
            await sleep(10);
            const count = got.out.length;
            count.should.be.above(1);
            got.ctl.length.should.equal(1);
            got.ctl[0].payload.should.equal("stopped");
            await sleep(100);
            got.out.length.should.equal(count);
        });
    });

    it("does not throw on non-string payloads", function () {
        return setup({ duration: "20", units: "Millisecond", maxloops: "1" }, async (n1, got) => {
            n1.receive({ payload: 42 });
            n1.receive({ payload: { a: 1 } });
            n1.receive({});
            await sleep(100);
            got.out.length.should.be.above(0);
        });
    });

    it("a new msg restarts the loop (no parallel loops)", function () {
        return setup({ duration: "30", units: "Millisecond", maxloops: "2" }, async (n1, got) => {
            n1.receive({ payload: "a" });
            await sleep(10);
            n1.receive({ payload: "b" });
            await sleep(300);
            const a = got.out.filter((m) => m.payload === "a").length;
            const b = got.out.filter((m) => m.payload === "b").length;
            a.should.equal(1);
            b.should.equal(3);
        });
    });

    it("msg.loop overrides maxloops and duration", function () {
        return setup({ duration: "5", units: "Second", maxloops: "100" }, async (n1, got) => {
            n1.receive({ payload: "go", loop: { duration: 20, units: "Millisecond", maxloops: 2 } });
            await sleep(250);
            got.out.length.should.equal(3);
            got.ctl[0].payload.should.equal("max loops reached");
        });
    });

    it("accepts Millisecond, Second, Minute, Hour, Day as msg.loop.units", function () {
        return setup({ duration: "20", units: "Millisecond", maxloops: "1" }, async (n1) => {
            const errors = [];
            n1.error = (e) => errors.push(e);
            for (const u of ["Millisecond", "Second", "Minute", "Hour", "Day"]) {
                n1.receive({ payload: "go", loop: { units: u, duration: 20 } });
                n1.receive({ payload: "stop" });
            }
            errors.should.have.length(0);
        });
    });

    it("rejects invalid msg.loop values with an error and does not send", function () {
        return setup({ duration: "20", units: "Millisecond" }, (n1, got) => {
            const errors = [];
            n1.error = (e) => errors.push(e);
            n1.receive({ payload: "go", loop: { units: "Fortnight" } });
            n1.receive({ payload: "go", loop: { duration: "5" } });
            n1.receive({ payload: "go", loop: { maxloops: "5" } });
            n1.receive({ payload: "go", loop: { maxtimeout: "5" } });
            n1.receive({ payload: "go", loop: { maxtimeoutunits: "Fortnight" } });
            errors.should.have.length(5);
            got.out.length.should.equal(0);
        });
    });

    it("stops with 'timeout' when the maximum timeout is reached", function () {
        return setup({ duration: "30", units: "Millisecond", maxloops: "1000", maxtimeout: "100", maxtimeoutunits: "Millisecond" }, async (n1, got) => {
            n1.receive({ payload: "go" });
            await sleep(400);
            got.ctl.length.should.equal(1);
            got.ctl[0].payload.should.equal("timeout");
            const count = got.out.length;
            await sleep(100);
            got.out.length.should.equal(count);
        });
    });

    it("clears timers on close", function () {
        return setup({ duration: "20", units: "Millisecond", maxloops: "100" }, async (n1, got) => {
            n1.receive({ payload: "go" });
            await sleep(50);
            await helper.unload();
            const count = got.out.length;
            await sleep(100);
            got.out.length.should.equal(count);
        });
    });
    describe("pause / resume (new in 1.0.0)", function () {
        it("freezes the loop and continues with the counters kept", function () {
            return setup({ duration: "100", units: "Millisecond", maxloops: "3", pausecontrol: true }, async (n1, got) => {
                n1.receive({ payload: "go" });
                await sleep(150); // one loop message sent
                n1.receive({ payload: "pause" });
                await sleep(20);
                const frozen = got.out.length;
                frozen.should.equal(2);
                got.ctl.map((m) => m.payload).should.eql(["paused"]);
                await sleep(300);
                got.out.length.should.equal(frozen);
                n1.receive({ payload: "resume" });
                await sleep(500);
                got.out.length.should.equal(4); // 1 original + 3 loops in total
                const first = got.out[2]; // first message after resume carries the pause length
                first.pauseduration.should.be.above(250);
                should(got.out[3].pauseduration).be.undefined();
                got.ctl.map((m) => m.payload).should.eql(["paused", "resumed", "max loops reached"]);
            });
        });

        it("works through msg.loop.command even when payload control is off", function () {
            return setup({ duration: "100", units: "Millisecond", maxloops: "10" }, async (n1, got) => {
                n1.receive({ payload: "go" });
                await sleep(30);
                n1.receive({ payload: "x", loop: { command: "pause" } });
                await sleep(200);
                got.out.length.should.equal(1);
                n1.receive({ payload: "x", loop: { command: "resume" } });
                await sleep(150);
                got.out.length.should.equal(2);
                n1.receive({ payload: "x", loop: { command: "stop" } });
            });
        });

        it("keeps the 0.0.x behaviour for payload 'pause' unless enabled", function () {
            return setup({ duration: "50", units: "Millisecond", maxloops: "1" }, async (n1, got) => {
                n1.receive({ payload: "pause" });
                await sleep(150);
                got.out.map((m) => m.payload).should.eql(["pause", "pause"]);
            });
        });

        it("can be stopped while paused", function () {
            return setup({ duration: "100", units: "Millisecond", pausecontrol: true }, async (n1, got) => {
                n1.receive({ payload: "go" });
                n1.receive({ payload: "pause" });
                n1.receive({ payload: "stop" });
                await sleep(300);
                got.out.length.should.equal(1);
                got.ctl.map((m) => m.payload).should.eql(["paused", "stopped"]);
            });
        });

        it("ignores pause when idle and resume when not paused", function () {
            return setup({ duration: "100", units: "Millisecond", pausecontrol: true }, async (n1, got) => {
                n1.receive({ payload: "pause" });
                n1.receive({ payload: "resume" });
                await sleep(30);
                got.out.length.should.equal(0);
                got.ctl.length.should.equal(0);
            });
        });
    });

    describe("totalcount mode (new in 1.0.0)", function () {
        it("maxloops: 1 gives exactly one message", function () {
            return setup({ duration: "30", units: "Millisecond", maxloops: "1", totalcount: true }, async (n1, got) => {
                n1.receive({ payload: "go" });
                await sleep(150);
                got.out.length.should.equal(1);
                got.ctl.map((m) => m.payload).should.eql(["max loops reached"]);
            });
        });

        it("maxloops: 3 gives exactly three messages", function () {
            return setup({ duration: "30", units: "Millisecond", maxloops: "3", totalcount: true }, async (n1, got) => {
                n1.receive({ payload: "go" });
                await sleep(250);
                got.out.length.should.equal(3);
            });
        });

        it("maxloops: 0 gives no message and -1 is unlimited", function () {
            return setup({ duration: "30", units: "Millisecond", maxloops: "0", totalcount: true }, async (n1, got) => {
                n1.receive({ payload: "go" });
                await sleep(100);
                got.out.length.should.equal(0);
                got.ctl.map((m) => m.payload).should.eql(["max loops reached"]);
                n1.receive({ payload: "go", loop: { maxloops: -1 } });
                await sleep(200);
                got.out.length.should.be.above(3);
                n1.receive({ payload: "stop" });
            });
        });

        it("can be switched per message", function () {
            return setup({ duration: "30", units: "Millisecond", maxloops: "1" }, async (n1, got) => {
                n1.receive({ payload: "go", loop: { totalcount: true } });
                await sleep(150);
                got.out.length.should.equal(1);
            });
        });
    });

    it("single call with maxtimeout shorter than the interval (workaround from issue #10) still works", function () {
        return setup({ duration: "5", units: "Second", maxloops: "100" }, async (n1, got) => {
            n1.receive({ payload: "go", loop: { maxloops: 0, maxtimeout: 20, maxtimeoutunits: "Millisecond" } });
            await sleep(150);
            got.out.length.should.equal(1);
        });
    });
});
