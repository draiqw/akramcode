# Settings Manager

Source: packages/coding-agent/src/core/settings-manager.ts

## Cache Warming Global-Only Setting
Cache warming mode is stored in global settings only, not project settings, because each warming operation costs money and should not vary per project.

## Synchronous Lock Acquisition
Lock acquisition sleeps synchronously instead of using async await. This avoids changing callers to async just to handle lock retry logic.
