# Session Manager

Source: packages/coding-agent/src/core/session-manager.ts

## Session File Persistence Strategy
Only session files are created when the session contains user or assistant messages. Setup entries (model, thinking level, system prompt) remain in memory. This avoids leaving empty files when users open and close akramcode without chatting. Starting at the user message rather than the first assistant reply keeps the prompt on disk if the first turn doesn't complete.

## Compaction Entry Retention
Older compaction entries may be retained even after newer compactions because their raw ID falls inside the newest retained range. Only the newest compaction at index zero contributes a checkpoint and summary to the context.

## Tree Sorting via Iteration
Tree traversal uses an iterative approach rather than recursion to sort children by timestamp. This prevents stack overflow on deep trees with many levels.

## Label Filtering and Re-chaining
Labels are filtered from branched session paths and later recreated from the resolved label map. This is necessary because labels are real tree entries that can have children; removing labels requires re-chaining the retained path to avoid orphaned subtrees.

## Branched Session File Writing
When creating a branched session, the file is written immediately if the branched path already contains a conversation, using the same rule as the main _persist() method. Otherwise, writing is deferred until _persist() determines the file should be created.
