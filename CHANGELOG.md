# Changelog

This project adheres to [Semantic Versioning](https://semver.org/) from 1.0.0 on.

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
