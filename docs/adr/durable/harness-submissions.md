# Submissions: Queuing and Waiting

Source: packages/durable/src/harness/submissions.ts

## Session Line Registration for Wait

Waiters are registered on the Session line in a single atomic read operation. This prevents a race where a settling publication arrives between checking the record status and registering the waiter, which would leave the waiter hanging indefinitely.

## Close During Wait Registration

Close can reject registered waiters synchronously and may begin while the storage read is in flight. The registration must account for being cancelled during the read.

## Boundary Preparation Timing

A boundary reads tables before the first commit write, so it must be prepared before any table writes. When a conversation is busy with a running task, preparing a boundary is skipped since the busy check already holds the table state.

## Submission JSON Normalization

Hosts may leave optional fields `undefined`, but durable drafts require strict JSON without `undefined` values. The submission uses `omitUndefinedProperties: true` to normalize incoming data.
