# Vacation Runtime Design

Source: packages/coding-agent/src/experimental/vacation/runtime.ts

## Main conversation receives only Vacation extension

The main conversation is configured with only the Vacation extension, whereas subagents select their own extensions (Search for research subagents). This segregation ensures each conversation has the appropriate toolset.

## Subagents appear when conversations are created

Subagent conversations are discovered at creation time via commit listeners, not API calls. A commit listener only records changes and cannot invoke Session methods, preserving transaction isolation.

## Abort does not queue

The abort operation waits until the conversation is idle rather than queuing behind other commands. This ensures immediate responsiveness to user cancellation requests.

## Task panel starts open

The UI shows the task panel by default; users can hide it with the `/tasks` command. This gives visibility into concurrent work in the system.

## Close without writing outcome

When closing the Harness, we do not write a final outcome. A running turn is automatically resumed on the next start with `--continue`, allowing graceful shutdown without terminating in-flight work.
