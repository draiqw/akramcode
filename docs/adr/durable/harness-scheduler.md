# Task Scheduler

Source: packages/durable/src/harness/scheduler.ts

## Scheduler-Only Faulted and Orphaned Outcomes

Only the scheduler can write `faulted` and `orphaned` outcomes. Harness cleanup for these outcomes waits in the same commit that writes the terminal record, ensuring cleanup runs atomically with the state transition.

## Serialized Commit Ordering

Never commit synchronously from a commit listener or registry subscription callback. Commits are always queued to the next microtask to preserve the event ordering invariant that every task transition is decided and written by one callback serialized on the Session line.
