# Tool Search Extension

Source: packages/coding-agent/src/extensions/tool-search/tool.ts

## Model-Only Exposure for Tool Search

The tool_search tool is exposed only to the model (not to scripts), as searching changes what tools the model sees in subsequent calls. Script execution should not have side effects on the active tool set.
