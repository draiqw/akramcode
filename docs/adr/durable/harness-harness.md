# Harness Implementation

Source: packages/durable/src/harness/harness.ts

## Close without caller context on open failure

When Harness.open() fails during openTasks(), we close the harness without the caller's context. The caller's context may itself be what caused the failure, so we use a fresh context without abort signal to ensure close completes, then rethrow the original error.
