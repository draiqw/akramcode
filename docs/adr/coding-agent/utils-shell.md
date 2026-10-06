# Shell Utilities

Source: packages/coding-agent/src/utils/shell.ts

## Trusted System Binary for Process Cleanup

Process cleanup on Windows uses the full System32 path to taskkill.exe to ensure cleanup does not depend on PATH. This prevents issues where a malicious taskkill.exe in PATH could interfere with process management.

## Async Error Handling in Spawn

Spawn reports launcher failures asynchronously via an error event. The error listener must be registered immediately to prevent the process from crashing if a spawn error occurs before the caller attaches their own handlers.

## Unix Process Group Killing Fallback

On Unix, killing a process group with negative PID is attempted first. If that fails, the code falls back to killing the single process, which handles cases where the process is already dead or no longer belongs to a group.
