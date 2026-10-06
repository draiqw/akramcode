# Subagent Extension
Source: packages/coding-agent/src/experimental/durable/subagent.ts

## Extension Removal for Child Conversations
Child conversations created for subagent tasks are copies of the parent conversation's agent configuration, but the subagent extension is removed to prevent infinite delegation loops. Without this removal, a subagent could spawn its own subagents indefinitely.
