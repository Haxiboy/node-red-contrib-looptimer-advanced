module.exports = function (RED) {
    "use strict";
    var Looper = require('loop');

    var unitMap = [
        { unit: "Millisecond", multiplier: 1, duration: 1 },
        { unit: "Second", multiplier: 1000, get duration() { return unitMap[0].duration * unitMap[1].multiplier } },
        { unit: "Minute", multiplier: 60, get duration() { return unitMap[1].duration * unitMap[2].multiplier } },
        { unit: "Hour", multiplier: 60, get duration() { return unitMap[2].duration * unitMap[3].multiplier } },
        { unit: "Day", multiplier: 24, get duration() { return unitMap[3].duration * unitMap[4].multiplier } }
    ]

    var CalcDuration = function (unit, duration) { return (unitMap.find(o => o.unit === unit).duration * duration); }
    function LoopTimer(n) {
        RED.nodes.createNode(this, n);

        this.units = n.units || "Second";
        this.duration = n.duration || 5;
        this.maxloops = n.maxloops || 100;
        this.maxtimeoutunits = n.maxtimeoutunits || "Hour";
        this.maxtimeout = n.maxtimeout || 1;
        this.nodeduration = n.nodeduration || 1;
        this.nodemaxtimeout = n.nodemaxtimeout || 1;

        if (this.duration <= 0) {
            this.duration = 0;
        }

        if (this.maxtimeout <= 0) {
            this.maxtimeout = 0;
        }

        var node = this;
        var loop = null;
        var timeout = null;
        var stopped = false;
        var cpmsg = null;
        var stopmsg = null;
        var mlmsg = null;

        this.on("input", function (msg) {
            loop = Looper();
            if (msg.loop != undefined) {

                if (msg.loop.units != undefined) {
                    if ((msg.loop.units === "Millisecond") || (msg.loop.units === "Second") || (msg.loop.units === "Hour") || (msg.loop.units === "Day")) {
                        node.units = msg.loop.units;
                    } else {
                        node.status({ fill: "red", shape: "ring", text: "Invalid attribbute msg.loop.units" });
                        node.error('Invalid Attribbute: msg.loop.units, allowed values are Millisecond, Second, Minute, Hour, and Day');
                        return;
                    }
                }


                if (msg.loop.duration != undefined) {
                    if (typeof msg.loop.duration === 'number') {
                        node.duration = msg.loop.duration;
                    } else {
                        node.status({ fill: "red", shape: "ring", text: "msg.loop.units must be an Integer" });
                        node.error('Invalid Attribbute: msg.loop.duration, value must be an Integer');
                        return;
                    }
                }

                if (msg.loop.maxtimeoutunits != undefined) {
                    if ((msg.loop.maxtimeoutunits === "Millisecond") || (msg.loop.maxtimeoutunits === "Second") || (msg.loop.maxtimeoutunits === "Hour") || (msg.loop.maxtimeoutunits === "Day")) {
                        node.maxtimeoutunits = msg.loop.maxtimeoutunits;
                    } else {
                        node.status({ fill: "red", shape: "ring", text: "Invalid attribbute msg.loop.maxtimeoutunits" });
                        node.error('Invalid Attribbute: msg.loop.maxtimeoutunits, allowed values are Millisecond, Second, Minute, Hour, and Day');
                        return;
                    }
                }


                if (msg.loop.maxtimeout != undefined) {
                    if (typeof msg.loop.maxtimeout === 'number') {
                        node.maxtimeout = msg.loop.maxtimeout;
                    } else {
                        node.status({ fill: "red", shape: "ring", text: "msg.loop.maxtimeout must be an Integer" });
                        node.error('Invalid Attribbute: msg.loop.maxtimeout, value must be an Integer');
                        return;
                    }
                }
                if (msg.loop.maxloops != undefined) {
                    if (typeof msg.loop.maxloops === 'number') {
                        node.maxloops = msg.loop.maxloops;
                    } else {
                        node.status({ fill: "red", shape: "ring", text: "msg.loop.maxloops must be an Integer" });
                        node.error('Invalid Attribbute: msg.loop.maxloops, value must be an Integer');
                        return;
                    }
                }



            }
            node.nodeduration = CalcDuration(node.units, node.duration);
            node.nodemaxtimeout = CalcDuration(node.maxtimeoutunits, node.maxtimeout);

            loop.setTimeout(node.nodemaxtimeout);
            loop.setMaxLoop(node.maxloops);
            node.status({});

            if (stopped === false || msg._timerpass !== true) {
                stopped = false;
                clearTimeout(timeout);
                timeout = null;
                if (msg.payload == "stop" || msg.payload == "STOP") {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: "stopped"
                    });
                    stopped = true;
                    stopmsg = RED.util.cloneMessage(msg);
                    stopmsg.payload = "stopped";
                    node.send([null, stopmsg]);
                    stopped = false;
                } else {
                    cpmsg = RED.util.cloneMessage(msg);
                    node.send([cpmsg, null]);
                    msg._timerpass = true;
                    loop.run(function (next, err, data) {
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: "running"
                        });
                        data++;
                        timeout = setTimeout(function () {
                            if (stopped === false) {
                                cpmsg = RED.util.cloneMessage(msg);
                                if (data == node.maxloops) {
                                    mlmsg = RED.util.cloneMessage(msg);
                                    mlmsg.payload = "max loops reached";
                                    node.send([cpmsg, mlmsg]);
                                    node.status({
                                        fill: "red",
                                        shape: "ring",
                                        text: "max loops reached"
                                    });
                                    timeout = null;
                                    next("break");
                                } else {
                                    node.status({});
                                    if ((data * node.nodeduration) <= node.nodemaxtimeout) {
                                        node.send([cpmsg, null]);
                                        timeout = null;
                                        if (((data + 1) * node.nodeduration) > node.nodemaxtimeout) {
                                            next("break");
                                        } else {
                                            next(undefined, data);
                                        }
                                    } else {
                                        timeout = null;
                                        next("break");
                                    }
                                }
                            } else {
                                timeout = null;
                                next("break");
                            }
                        }, node.nodeduration);
                    }, 0);
                }
            }
        });
        this.on("close", function () {
            stopped = false;
            if (timeout) {
                clearTimeout(timeout);
            }
            node.status({});
        });
    }
    RED.nodes.registerType("looptimer-advanced", LoopTimer);
}
