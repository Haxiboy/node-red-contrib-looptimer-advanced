# Changelog

This project adheres to [Semantic Versioning](https://semver.org/) from 1.0.0 on.

## [1.1.1]

### Fixed
- Commands (`stop`, `pause`, `resume`, `status`) and messages ignored while a loop runs no longer need the typed settings. A `stop` without e.g. `msg.interval` used to fail with an error and the loop kept running. The settings are now only read for a message that starts a loop.
- Intervals, maximum timeouts and pause timeouts longer than about 24.8 days (2^31-1 ms) fired after a millisecond, because Node.js clamps such a delay. They now wait the full time.
- The loop interval has to be greater than 0. An interval of 0 (also `msg.loop.duration`, or a typed value) made every tick due at once and, without a loop limit, flooded the output forever. It is now rejected with an error and no loop is started. Non-finite numbers (`Infinity`) are rejected in all numeric `msg.loop` overrides. A maximum timeout of `0` still works.
- `msg.loop` overrides are applied all or nothing. `{ units: "Minute", duration: "abc" }` reported the error but left the units changed for the later messages.

## [1.1.0]

All new settings are off by default (or default to the old behavior), existing flows keep working unchanged.

### Added
- **Send the first message immediately** setting and `msg.loop.sendfirst`. Without it the first message goes out after the first interval (the option announced in #4).
- **msg.loopstate** with `state`, `count`, `sent`, `max`, `remaining`, `elapsed` and `interval` on every message, switched on with *Add the loop counters* or `msg.loop.loopstate`.
- **status** command (payload, when payload commands are on, or `msg.loop.command`) that reports the state of the loop on output 2.
- **New message** setting: `restarts the loop` (as before), `is ignored while a loop runs`, or `starts a separate loop per msg.topic`. In the per-topic mode `msg.loop.all = true` applies a command to all loops, and the node status shows the number of loops.
- **Pause timeout** with `resume` or `stop` after it (`msg.loop.pausetimeout`, `pausetimeoutunits`, `pauseaction`), the open question of #7. Output 2 then has `msg.reason = "pause timeout"`.
- **Typed settings**: *Loop Every*, *Max Loops* and *Max Timeout* can be read from `msg.`, `flow.`, `global.` or `env`.
- Tests for all of the above.

### Changed
- The ticks are due at fixed times after the start instead of one interval after the previous tick, so a long loop does not drift. The schedule is kept across a pause, and a loop that was stalled for more than an interval carries on from now instead of sending a burst.
- Payload `status` is a command when payload commands are on (the setting is now called *Pause / resume / status with payload*). Existing nodes have it off.

## [1.0.0]

### Added
- Pause / resume via payload (opt-in per node) or `msg.loop.command`; `paused` / `resumed` on output 2 and `msg.pauseduration` after a resume (#7).
- "Max Loops counts the first message too" option and `msg.loop.totalcount` for an exact message count, including a single call (#10).
- Automated tests (mocha + node-red-node-test-helper) covering the 0.0.x behaviour and the new features.
- Help text in the editor sidebar, CHANGELOG.

### Changed
- Rewritten internals on plain timers, `loop` dependency removed.
- Requires Node-RED >= 3.0 and Node.js >= 18.
- Editor templates use `text/html` script blocks.
- A loop ending because of the maximum timeout always sends `timeout`.

### Fixed
- A `stop` arriving between two loop iterations could be ignored.
- Timers left running after stop / redeploy.

## [0.0.12] and earlier
See the git history.
