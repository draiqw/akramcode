# Compaction Task

Source: packages/durable/src/harness/compaction.ts

## Immutable context at tail

The context at the `tail` entry is immutable when we enter the summarize phase, so we can safely rely on the range of entries discovered in the `select` phase remaining unchanged for processing.

## Tool result placement before next assistant

When determining whether an entry is a valid compaction cut point, tool results that follow the entry but precede the next assistant message must be considered. A tool result for a preceding assistant's calls belongs logically before the current entry, making the current entry a valid cut point.
