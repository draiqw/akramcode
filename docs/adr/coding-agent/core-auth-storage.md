# Auth Storage Implementation
Source: packages/coding-agent/src/core/auth-storage.ts

## File Mode Constraint
File mode is set only at creation time to allow administrators to manage modes and ACLs post-creation without being overwritten by subsequent writes.

## Synchronous Sleep Pattern
Busy-wait instead of async sleep in lock acquisition retry to avoid changing all callers to async; this keeps the synchronous API surface intact.

## Lock Compromise Error Handling
Unlock errors are silently ignored when the lock has been compromised by another process, to avoid masking the primary lock compromise error with secondary release failures.
