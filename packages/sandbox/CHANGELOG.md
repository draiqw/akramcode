# Changelog

## [1.0.27] - 2026-10-11

## [1.0.26] - 2026-10-10

## [1.0.25] - 2026-10-10

### Added

- Added the sandbox provider layer: OpenSandbox sandboxes per session with reuse, leases, a persistent shell session, per-session workspace volumes and eviction.

### Fixed

- A sandbox that never becomes ready is deleted on the server instead of being left running, and startup fails with `OpenSandbox is unavailable at <domain>: <reason>`.
- A new shell session is proven with a no-op (30 s deadline, one retry) before the first command, so a sandbox whose command channel never answers fails with `The sandbox shell is not responding` instead of hanging silently.
