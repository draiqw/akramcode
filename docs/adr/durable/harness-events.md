# Agent Event Stream

Source: packages/durable/src/harness/events.ts

## Watch batches and overflow behavior

Event batches are the core watch's delivered values. When a watch overflows (undelivered batches pile up), we replace undelivered batches with a snapshot of the current view, ensuring delivery doesn't fail and old stale batches are discarded.

## Submission ordering

When translating commit changes, submission records are sorted by ID. This ensures they are published in the order the commit first touched them, providing a consistent event ordering.

## Slot result lookup for completed runs

When a slot's run ends and the slot is no longer tracked, we must look up its result entry in the newly appended entries. This handles both unstarted tool calls (which get results created immediately) and calls that completed during the run.

## Event ordering: entries and tool ends

Events are published in the order entries are appended. A tool's completion event directly precedes its result entry's message, matching the pattern used in the coding agent's event stream.

## Streamed answer handling

When an answer is streamed from a partial (already has a message_start from the partial), we skip emitting message_start again. The `message_end` event for the final entry is still emitted.

## Generation turn ending

A generation's turn ends when its outcome is committed. This happens either at a `completing` status hold or at terminal status, whichever comes first. This ordering ensures a successor generation created at the hold starts after the turn ends.

## Retired document state

When a document is retired (no longer stored), it reads as its initial value, consistent with how snapshots represent documents.

## Block tracking for message deltas

When translating view operations on a message's content, a block that is sent whole already contains every later change to it. We track such blocks to skip emitting delta events that would be redundant.

## Safe replay of slot progress

During replay of a running slot's progress, removed details are represented as `null` and removed diagnostics as an empty array. This allows a safe replay to clear progress that was accumulated during an earlier attempt.
