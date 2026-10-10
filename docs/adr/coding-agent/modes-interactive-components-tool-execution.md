# Tool Execution Component

Source: packages/coding-agent/src/modes/interactive/components/tool-execution.ts

## Shell Variant Creation Strategy

All shell variants (contentBox, selfRenderContainer, contentText) are created upfront regardless of which is needed. ContentBox is used for default renderer-based composition, selfRenderContainer for tools that render their own framing, and contentText as a fallback when no tool definition exists. This avoids conditionally creating components mid-render.

## Collapsed Tool Groups

Consecutive tool calls are wrapped in a `ToolGroupComponent` (tool-group.ts) that renders one dim summary line, such as `Read 2 files, ran 1 shell command · Running npm test…`, plus a line per failed call. A call joins the last group unless an assistant message with text or thinking was added after it; assistant messages that only carry tool calls render nothing and do not split groups. Live events and session replay add calls through the same `addToolExecutionToChat`, so both group the same way. Expanding (app.tools.expand or a click on the line) renders the tool components unchanged; they keep receiving updates while collapsed. `collapseToolGroups: false` adds tool components directly to the chat.
