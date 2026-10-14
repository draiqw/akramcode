# Compaction Utilities

Source: packages/coding-agent/src/core/compaction/utils.ts

## Nested Tool Calls Recording

Tool calls made from codemode scripts are recorded in the `nestedCalls` field of the tool result message, rather than as direct tool call blocks in the assistant message. This allows post-processing and tracking of tool execution chains within custom scripts.
