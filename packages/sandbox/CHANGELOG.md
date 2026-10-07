# Changelog

## [Unreleased]

### Added

- Added the sandbox provider layer: OpenSandbox sandboxes per session with reuse, leases, a persistent shell session, per-session workspace volumes and eviction.

### Fixed

- A sandbox that never becomes ready is deleted on the server instead of being left running, and startup fails with `OpenSandbox is unavailable at <domain>: <reason>`.
