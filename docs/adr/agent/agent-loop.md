# Agent Loop

Source: packages/agent/src/agent-loop.ts

## Initial Steering Message Poll

The agent loop checks for steering messages at the start of its execution. This accommodates scenarios where the user may have typed new instructions while the loop was initializing, ensuring those messages are included in the first turn rather than delayed.

## Conditional Steering Poll During Preparation

Preparation of the next turn can be long-running (e.g., message compaction). When preparation finishes, we poll for queued steering messages. However, we only poll again if the previous poll returned nothing. This prevents delivering two messages in a single turn when using one-at-a-time queue mode, which would violate the mode's semantics.

## Truncated Tool Call Handling

When the LLM response hits the output token limit (stopReason "length"), the streamed tool-call arguments are finalized with a best-effort JSON parser. This can result in tool calls whose arguments parse and validate successfully but are silently incomplete. None are safe to execute, so we fail all of them with an error, allowing the model to re-issue complete calls.

## Tool Change Declaration Optimization

When declaring tool changes to the model, we avoid allocating a new message object if the caller's message already declares no tool changes. This optimization reuses the caller's object and reduces allocations during message processing.
