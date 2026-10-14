# Task Graph View

Source: packages/durable/src/harness/task-graph.ts

## Registration Race Condition Handling

After creating an observer from the current mount revision, check if close or cancellation occurred during the build. If so, throw without registering the observer. This ensures no observers are registered if the session is closing or the operation was cancelled.

## Publication Processing Order

Process task records before conversation ownership changes in the same publication. Conversations created with their owner task in one commit need to find the owner's node already in the graph. Since change order within a publication is unspecified, each owner's conversation list is sorted after processing all ownership changes.
