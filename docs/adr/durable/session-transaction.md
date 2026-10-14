# Transaction Management and Assembly

Source: packages/durable/src/session/transaction.ts

## Submission record fields

Queued and placed submission records carry no answer, reason, or detail; only settled records do. An unanswered input keeps its entry ID for reference, but no other metadata.

## Undefined field omission

When copying entry records to Storage, undefined values for `head` and `byTaskId` fields are omitted using the copy options flag. This keeps Storage records clean and minimal.

## Deferred owner validation

Owner task validation during creation is a preliminary check only. The final validation runs during assembly before Storage admission, against the owner's final candidate state to catch any invalidation that occurred after creation.

## Retirement capture timing

Retirement status must be captured synchronously before awaiting acquisition. This ensures that if a pending old acquisition and its replacement occur in the same transaction, they remain distinct for assembly to process correctly.

## Draft retirement persistence

When retiring an already-acquired draft, the draft's final content must persist to Storage before the retirement marker. We wait for the acquisition promise to settle, ensuring the draft is complete.

## Synchronous preparation and draft revocation

All open changes are prepared synchronously in a loop. This revokes every mutable draft, making them immutable before any async work like Storage submission.

## Adoption conditions

New incarnations (created in this transaction) are adopted unless they retire in the same commit. Loaded incarnations are adopted only if they actually changed (have operations to apply).

## Terminal document retirement

When a task reaches a terminal state, every document owned by that task must be retired, including ones created in the same commit. This happens in assembly before Storage admission.

## Pre-admission publication resolution

Publication ownership for each document is resolved before Storage admission so the adoption phase can remain fully synchronous. Task documents need their owning conversation resolved from the task's current state.

## Checkpoint ordering

Checkpoint predicates run last in the assembly phase, after all validations. This ensures predicates see the final prepared state and can make informed decisions about base conversion.

## Version change base requirement

When a document definition version changes, Storage must record a new base even if the value has no changes (empty operations). This ensures observers of the old version see the migration and get the updated value.
