# Agent Session Runtime

Source: packages/coding-agent/src/core/agent-session-runtime.ts

## Settle active response before teardown

Active responses must be persisted to the outgoing session before it is replaced, ensuring that any aborted turn including its tool results is saved to the current session state before switching to a new one.
