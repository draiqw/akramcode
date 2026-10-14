# Durable Runtime Session Management
Source: packages/coding-agent/src/experimental/durable/runtime.ts

## Commit Listener Design
Subagents appear as their conversations are created through commit listeners. These listeners only record changes and do not invoke Session API directly, avoiding potential issues with nested API calls.
