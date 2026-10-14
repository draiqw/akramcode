# Conversation View Mounts

Source: packages/durable/src/harness/view.ts

## Race condition during mount hydration

Close or cancellation may begin while the mount builds asynchronously. The check after creation ensures we do not register an observer to a mount if the Session is closing or the call's context was already aborted, preventing the observer from being added to a mount that will never fire events again.
