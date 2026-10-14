# RPC Client Implementation

Source: packages/coding-agent/src/modes/rpc/rpc-client.ts

## Process initialization delay

Spawned child processes need a brief moment to initialize before we can safely assume they are ready. A 100ms delay gives the process time to set up its event listeners and prepare to receive commands.

## Event snapshot iteration

When dispatching events to listeners, iterate over a snapshot of the listener array rather than the live list. This prevents listeners that unsubscribe during dispatch from causing subsequent listeners to miss the current event.

## Type assertion for response data

The type assertion `response.data as T` is safe because each public method specifies the correct generic type T for its command. The RPC protocol ensures that response data matches the command type sent, so we can trust this at the call site.
