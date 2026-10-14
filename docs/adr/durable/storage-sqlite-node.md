# SQLite Node Adapter - Serial Operation Queue

Source: packages/durable/src/storage/sqlite/node.ts

## Publish barrier before operation starts

When publishing a barrier promise to the queue before an async operation starts, calls the operation makes synchronously will wait behind that barrier. This ensures proper serialization of subsequent operations even if they are initiated during the current operation's execution.
