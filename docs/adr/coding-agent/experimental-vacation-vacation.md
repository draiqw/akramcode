# Vacation Extension Design

Source: packages/coding-agent/src/experimental/vacation/vacation.ts

## Subagent conversation ownership constraint

The subagent's conversation is owned by this task. A critical constraint: no Session API methods may run inside a commit transaction, as this would violate transaction semantics and cause deadlocks.

## Idempotent submissions after crashes

Each submission uses a unique `requestId` derived from the task ID. A rerun after a crash retrieves the same submission, ensuring idempotency without duplicate work.

## Research runs in the background

The research task is marked with `background: true`. This allows the main conversation to remain responsive for further user interaction while research proceeds in parallel.
