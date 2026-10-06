# Assistant Message Component

Source: packages/coding-agent/src/modes/interactive/components/assistant-message.ts

## Assistant Text Message Rendering

Text messages are rendered with no background. Content is trimmed and paddingY is set to 0 to avoid extra spacing that would appear before tool execution blocks.

## Spacing After Thinking Blocks

Spacing is only added after thinking blocks when another visible assistant content block (text or thinking) follows. This prevents superfluous blank lines from appearing before separately-rendered tool execution blocks.

## Incomplete Response Errors

When a response is incomplete or has errors (truncated, aborted, or had errors), these are shown after the partial content. This includes length-truncated responses, which need to surface errors even when there are no tool calls, unlike other error types that are handled by tool execution components.
