# Advanced Looptimer for Node-RED

[![npm](https://img.shields.io/npm/v/node-red-contrib-looptimer-advanced)](https://www.npmjs.com/package/node-red-contrib-looptimer-advanced)
[![license](https://img.shields.io/npm/l/node-red-contrib-looptimer-advanced)](LICENSE)

Sends the `msg` through the first output, then repeats it once per the configured duration until it is stopped, the maximum number of loops is reached or the maximum timeout expires. Every setting can be overridden per message with `msg.loop`.

This project is based on **node-red-contrib-looptimer** and **node-red-contrib-looptimer2**, with the need to override properties via messages.

## Installation

```
npm install node-red-contrib-looptimer-advanced
```

Or use *Manage palette* in the Node-RED editor. Requires **Node-RED 3.0+** and **Node.js 18+**. Older runtimes should stay on `0.0.x`.

## Versioning

Starting with **0.1.0** this package follows [Semantic Versioning](https://semver.org/) and keeps a [changelog](CHANGELOG.md) in the [Keep a Changelog](https://keepachangelog.com/) format:

- **patch** (0.1.x): bug fixes only,
- **minor** (0.x.0): new, backwards compatible features,
- **major**: breaking changes, always announced in the changelog.

The old `0.0.x` numbering was an ad-hoc one-increment-per-change scheme. 0.1.0 is a modernised, tested rewrite of the internals, but existing flows keep working unchanged: all new features are opt-in or use previously unused properties. The automated test suite (`npm test`) pins the 0.0.x behaviour.

## Behaviour

- The first `msg` is sent immediately through output 1, then once per loop. It is not part of the loop, so *Max Loops* `5` gives **6** messages (1 original + 5 loops). Tick **Max Loops counts the first message too** to get exactly the configured number instead (`1` = single message, `0` = nothing, `-1` = unlimited).
- A payload of `stop` / `STOP` stops the loop; output 2 sends `stopped`.
- When *Max Loops* is reached, output 2 sends `max loops reached`.
- When *Max Timeout* expires, output 2 sends `timeout`.
- Any new message restarts the loop; two loops never run in parallel in one node.

### Overriding with `msg.loop`

| Property | Type | Description |
|---|---|---|
| `msg.loop.duration` | number | Loop interval |
| `msg.loop.units` | string | `Millisecond`, `Second`, `Minute`, `Hour`, `Day` |
| `msg.loop.maxtimeout` | number | Maximum run time |
| `msg.loop.maxtimeoutunits` | string | Same units as above |
| `msg.loop.maxloops` | number | Maximum number of loops |
| `msg.loop.totalcount` | boolean | Max Loops counts the first message too |
| `msg.loop.command` | string | `stop`, `pause` or `resume` |

Overrides stay in effect for the following messages (this is how 0.0.x worked). If you build `msg.loop` in a function node, create the object first: `msg.loop = { maxloops: 5 };`.

### Pause / resume (new in 0.1.0)

Send payload `pause` / `resume` (when *Pause / resume with payload* is ticked) or `msg.loop.command = "pause"` / `"resume"` (always available).

- Pausing freezes the remaining time of the current interval, the loop counter and the timeout budget. Resuming continues from there.
- Output 2 sends `paused` / `resumed`.
- The first loop message after a resume carries `msg.pauseduration`, the time spent paused in milliseconds.
- Pause/resume can be combined with `stop`; stopping while paused works.
- For flows created with 0.0.x the payload option is **off**, so a payload of `pause` is looped like any other value, exactly as before.

### Single call

Use *Max Loops counts the first message too* with `1`. The old workaround (`maxloops: 0`, short `maxtimeout`) still works, but now also sends `timeout` on output 2.

## Differences from 0.0.12

- The `loop` dependency is gone; the node uses plain timers. This fixes a stop request that arrived at the wrong millisecond being lost, and a leftover timer per message that kept running until the max timeout.
- A loop that ends because the maximum timeout expired before the next tick now always sends `timeout` (before, it sometimes ended silently).
- Errors for invalid `msg.loop` values are reported through the standard error handling (Catch node), and `done()` is called.
- Minimum versions: Node-RED 3.0, Node.js 18.

## Development

```
npm install
npm test
```
