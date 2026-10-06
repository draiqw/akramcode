# Session Kernel Design

Source: packages/durable/src/session/session.ts

## Close ordering

Closing must seal admission first to prevent new work entry, then stop observers so they do not track changes that will not occur. Admitted work settles before Storage closes to ensure consistent state.

## Cancellation after admission

Once a commit is admitted to Storage, caller-provided cancellation signals are suppressed. Storage settlement must complete without interruption to ensure atomicity and consistency.

## Error handling after storage admission

When Storage admits a batch, we must distinguish between callback errors (which do not reach this point) and Storage errors. Only StorageRejected guarantees that no batch effects were committed; other errors leave us in an unknown state, requiring poisoning to prevent further operations.

## Adoption failure poisoning

If adoption fails after Storage has committed, the transaction memory is already inconsistent with durable state. The session must be poisoned to prevent further use, since memory no longer reflects committed truth.

## Observer cancellation semantics

Document state observers have their frames delivered without caller cancellation to ensure all changes are seen. Watch observers, however, observe their own cancellation to allow callers to stop listening.

## Migration-only bases

A version migration that changes the definition but produces the same value is represented as a new base. When an observer receives such a change, the operations will be empty—nothing changed from the observer's perspective—so it should not be delivered.

## Tracker version binding

Trackers are bound to the definition version they were materialized under. Cached trackers serve only requests for that exact version; requests for other versions trigger a reload and rematerialization from Storage.
