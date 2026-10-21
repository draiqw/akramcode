# Changelog

## [1.0.36] - 2026-10-21

## [1.0.35] - 2026-10-19

## [1.0.34] - 2026-10-19

## [1.0.33] - 2026-10-19

## [1.0.32] - 2026-10-18

## [1.0.31] - 2026-10-18

## [1.0.30] - 2026-10-15

## [1.0.29] - 2026-10-14

## [1.0.28] - 2026-10-12

## [1.0.27] - 2026-10-11

## [1.0.26] - 2026-10-10

## [1.0.25] - 2026-10-10

### Added

- Added the sandbox provider layer: OpenSandbox sandboxes per session with reuse, leases, a persistent shell session, per-session workspace volumes and eviction.

### Fixed

- A sandbox that never becomes ready is deleted on the server instead of being left running, and startup fails with `OpenSandbox is unavailable at <domain>: <reason>`.
- A new shell session is proven with a no-op (30 s deadline, one retry) before the first command, so a sandbox whose command channel never answers fails with `The sandbox shell is not responding` instead of hanging silently.
