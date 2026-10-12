# Changelog

## [Unreleased]

## [1.0.28] - 2026-10-12

## [1.0.27] - 2026-10-11

## [1.0.26] - 2026-10-10

## [1.0.25] - 2026-10-10

## [1.0.0] - 2026-10-01

## [0.99.2] - 2026-09-30

## [0.99.1] - 2026-09-29

## [0.99.0] - 2026-09-29

## [0.87.1] - 2026-09-22

## [0.87.0] - 2026-09-21

## [0.86.1] - 2026-09-20

## [0.86.0] - 2026-09-19

## [0.85.1] - 2026-09-05

## [0.85.0] - 2026-09-04

## [0.84.4] - 2026-08-28

## [0.84.3] - 2026-08-24

## [0.84.2] - 2026-08-14

## [0.84.1] - 2026-08-07

## [0.84.0] - 2026-08-06

### Breaking Changes

- Replaced `SessionSummary` with durable `SessionMetadata` for `AkramCodeClient.listSessions()` and server snapshots; runtime state is available only from acquired session snapshots ([#7708](https://github.com/draiqw/akramcode/pull/7708)).

### Added

- Added the experimental transport-neutral `AkramCodeClient` and multi-session `PiSessionHandle` APIs with structured `PiServerError` responses.
