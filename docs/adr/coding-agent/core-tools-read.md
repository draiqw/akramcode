# Read Tool

Source: packages/coding-agent/src/core/tools/read.ts

## Offset indexing conversion

Convert offset from 1-indexed user input to 0-indexed array access because users think in 1-indexed line numbers (line 1 is the first line), but JavaScript arrays are 0-indexed.

## Fallback for oversized first lines

When the first line alone exceeds the byte limit, provide a bash fallback command instead of trying to truncate within the line. This allows the user to read the oversized line in parts if needed.
