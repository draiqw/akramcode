# Agent Session - Core Design Decisions

Source: packages/coding-agent/src/core/agent-session.ts

## Event Dispatch Before State Emission

When a user message starts, we remove it from steering or follow-up queues BEFORE emitting the event. This ensures the UI sees the updated queue state immediately, preventing race conditions where the queue display hasn't updated yet.

## Immediate Retry Counter Reset

After a successful assistant response, reset the retry attempt counter immediately rather than waiting for post-run handling. This prevents accumulation across multiple LLM calls within a single turn, ensuring accurate retry attempt tracking.

## Deferred Custom Messages During Turns

Context-only custom messages must not be appended during an active agent turn, as they would land between a tool call and its result—a message sequence that providers with validation reject on replay. Defer these messages to the end of the turn after tool results are finalized.

## In-Place Message Mutation for State Consistency

Extensions can replace messages via `emitMessageEnd()` handlers. Agent-core stores finalized messages in state before emitting message_end. By mutating this object in place, we keep agent state, later turn/agent events, listener callbacks, and eventual SessionManager persistence all in sync.

## Early Normalization of Extension Messages

Untyped extension handlers can return messages with null or missing content. Normalize these at ingestion rather than later, ensuring they never enter agent state or session history with invalid data.

## Safe Disposal With Error Recovery

The dispose() method must succeed even if an abort hook throws an error. Use try/catch to ensure cleanup completes regardless of hook failures.

## Tool Loadout Deactivation Semantics

A loadout that deactivates a tool (moves it from the active set) replaces the restored one, and its pending tools are dropped. In contrast, a loadout that only adds tools (like activating tool_search) preserves the pending set.

## Hidden Tools Not Listed in Prompts

Tools without a prompt snippet are not listed. Hidden tools are only callable through another tool (via `ctx.executeTool()`), so they are not included in the model's tool declarations.

## Tool Declarations Must Match Request

The tool list in the system prompt must match the declarations the request carries. Hidden tools are filtered out to maintain consistency between what the model sees and what it can actually use.

## Failed Response Clear Before New Prompt

Compaction before the prompt may have scheduled a retry; the new user prompt replaces that scheduled retry. Clear the failed response reference to prevent stale retry state.

## Pending Tool Registration Cleanup

The session transcript records the loadout for the run. Restored tools that did not register by run time are dropped, so a tool that never registers does not stay in the pending set indefinitely.

## Queue Draining Before Agent End

The low-level loop drains both steering and follow-up queues before emitting agent_end. Messages queued by agent_end handlers require a fresh agent run before pre-settlement handlers fire, preventing out-of-order execution.

## Extension Commands Execute Immediately

Extension commands execute immediately, even during streaming, because they manage their own LLM interaction via `sendMessage()`. They bypass normal streaming behavior and must not be queued.

## Image Normalization After Extension Hooks

Emit the before_agent_start hook before normalizing images so extension-driven model selection determines the resize profile used for the request and historical context.

## Tool Selection Authority After Hooks

After before_agent_start handlers run, if a handler edits `event.systemPromptOptions.selectedTools` or calls `setActiveTools()`, that explicit edit wins. Otherwise, the live loadout is authoritative and setActiveTools() calls are not undone.

## Message Building After Normalization

Build messages only after extension hooks and image normalization complete. This ensures all transformations and model-driven sizing decisions are finalized before messages enter the agent.

## Model-Specific Overflow Checks

Skip overflow checks if the assistant message came from a different model than the current one. When a user switches from a smaller-context model to a larger-context model, an overflow error from the old model shouldn't trigger compaction for the new model. Under a virtual selection, the physical model that produced the message supplies the applicable limits.

## Recoverable Length Stops

A length stop (truncated output) is recoverable when the output ended below the model's original desired limit, independent of the configured context window or any context-clamped provider request limits. This allows recovery attempts even when context appears over-used.

## No Retry After Completed Response

If a response completed successfully (stopReason === "stop"), don't retry even if compaction is needed. The agent's `continue()` cannot continue from a completed assistant response—it needs a new prompt.

## Threshold Compaction With Estimation

For error messages or zero-usage responses, estimate context from the last valid response instead of failing. This ensures sessions hit persistent API errors or malformed responses can still compact without resetting context accounting.

## Usage Staleness Checks After Compaction

After compaction, the last assistant message's usage reflects pre-compaction context size (larger). Only trust usage from assistants that responded after the latest compaction boundary. Pre-compaction usage falsely triggers compaction right after one finishes.

## Continue After Auto-Compaction

Auto-compaction can complete while follow-up, steering, or custom messages are waiting. Continue once so queued messages are delivered before settling.

## Tool Activation On Registration

Tools already activated on registration stay in the registry. A tool whose exposure changes to `direct` (e.g., from `hidden`) is activated like a new tool registration.

## Tool Allowlist Activation Behavior

When tools are named in the allowlist, they are activated even when not active by default. This explicit naming overrides the default activation policy.

## DefaultTools Setting Reload Semantics

When reloading, activate tools newly added to the defaultTools setting. Tools removed from it stay active. Tools disabled during the session stay disabled unless the setting newly adds them.

## Pending Tool Registration Preservation

Tools the new extensions register later (e.g., MCP tools) remain pending until they register. They are not lost during reload.

## Context Overflow Handled By Compaction

Context overflow errors are NOT retryable—they are handled by compaction instead. Skip retry checks for overflow messages and let compaction recovery handle them.

## Failed Attempt Persistence Before Recovery Compaction

Keep the failed attempt in raw history while durably omitting it from the model projection during overflow recovery. This preserves the record while preventing the error from being replayed.

## Shell Command Prefix For Alias Support

Apply the configured shell command prefix (e.g., "shopt -s expand_aliases") before executing bash commands. This allows session configuration to enable shell features globally.

## Deferred Bash Messages During Streaming

If the agent is streaming, defer bash messages to avoid breaking tool_use/tool_result ordering. Queue them for flushing after the agent turn ends, keeping the message sequence valid.

## Tree Navigation Stays In Session File

Unlike fork() which creates a new session file, tree navigation using `navigateTree()` stays in the same file. This supports branching exploration within a single session.

## Session Statistics Aggregation

Session statistics aggregate over ALL entries in the session (including history compacted away), so token and cost totals reflect what was actually billed to the account across the entire session.

## Post-Compaction Usage Trust

After compaction, only trust usage from an assistant that responded after the latest compaction boundary. If no such response exists, the context token count is unknown until the next LLM response arrives.

## Thinking level application

When the model changes, the thinking level is applied through `setThinkingLevel`, which clamps it to the new model's capabilities. A per-model default takes priority over the global default. Persisting the chosen model does not implicitly rewrite the global thinking default.

## Session Worktrees Move The Working Directory Only

A session moves into its own git worktree in `beforeToolCall`, before the first `edit`, `write`, or state-changing git command, so read-only sessions never create one. The move changes only the working directory: tools, extension contexts, `!` commands, and the `cwd` and `worktree` prompt sections. Settings, the resource loader, project trust, and the session directory stay at the main checkout, so `/resume` lists the session under the project. A `worktree` custom entry records the move with the session id; a resume re-enters it, a fork (new id) creates its own. Parallel calls share one move promise, and path arguments of the main checkout are rewritten in place because the agent loop runs the tool with the same object.
