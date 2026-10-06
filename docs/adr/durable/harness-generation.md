# Generation Task

Source: packages/durable/src/harness/generation.ts

## Blocking compaction before request

When context would exceed the blocking threshold, we compact first and re-enter prepare rather than proceeding to request. The transcript remains unchanged until the compaction appends, allowing us to reconsider the context window.

## Compaction check timing

Compaction state is checked within the commit that appends system entries. This ensures that if a compaction was admitted during preparation, it is counted immediately.

## Tool task results after terminal

After the tool-calling round's tasks become terminal, this runs to handle calls that never started: they receive `aborted` results as specified in the task model.

## Synchronous partial copy

Partials from the model provider are copied synchronously before committing them. The provider keeps mutating its partial object after yielding it, so we must copy before the async commit.

## Error handling after abort

Rejections in partial commit promises are expected after an abort mark or close, because the commit itself or the runtime signal cancellation can cause them. In these cases, the committed state remains consistent and we don't report the error.

## Empty partial handling

Partials without content (such as opening `start` events) are skipped. Deferred responses never get past this point without content, so they never leave a partial to be committed.

## Abort handling in classify

When an abort mark or close happens during classification, the abort invocation or the reopened run handles the committed state, so it's safe to throw immediately.

## Settings read on classify

The retry and compaction policies are read during classification of the response, not pinned at preparation time. This allows them to be updated based on current settings and the response status.

## Overflow non-retriable

An overflow error is never retried. Only compaction can make the next request fit within the context window, so we proceed to either compact and retry preparation or fail.

## Tool resolution timing

Tools and their execution mode are read when the tool round starts. A tool is later resolved by its tool task as it executes, so this read captures the agent's initial configuration.

## All calls must request terminate

Every tool call of the round, including those answered without a task (because they weren't offered), must ask for termination via its control. The terminate flag is only set if every call's task provides it.

## Last handoff wins

Among all the tool controls from the round, the last handoff found in call order is selected as the final handoff to apply. This gives the last tool a chance to hand control.

## Reset before answer

A queued reset that comes before the final boundary cuts the run's context, preventing an answer from being generated. The run settles as `unanswered` with reason `reset`.
