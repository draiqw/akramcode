# Tool Execution Component

Source: packages/coding-agent/src/modes/interactive/components/tool-execution.ts

## Shell Variant Creation Strategy

All shell variants (contentBox, selfRenderContainer, contentText) are created upfront regardless of which is needed. ContentBox is used for default renderer-based composition, selfRenderContainer for tools that render their own framing, and contentText as a fallback when no tool definition exists. This avoids conditionally creating components mid-render.
