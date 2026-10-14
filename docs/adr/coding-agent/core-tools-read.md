# Read Tool

Source: packages/coding-agent/src/core/tools/read.ts

## Offset indexing conversion

Convert offset from 1-indexed user input to 0-indexed array access because users think in 1-indexed line numbers (line 1 is the first line), but JavaScript arrays are 0-indexed.

## Fallback for oversized first lines

When the first line alone exceeds the byte limit, provide a bash fallback command instead of trying to truncate within the line. This allows the user to read the oversized line in parts if needed.

## Line numbers in text output

Each text line is returned as `<number>\t<line>`, numbered from the start of the file, so the model can cite `file:line` without counting lines itself. Without numbers, models gave line citations that were off by one. The prefix costs a few tokens per line. The tool description tells the model the prefix is not file content; the edit tool also drops copied prefixes from `oldText` (and `newText`) when every line has one and only the stripped text matches the file. The TUI renderer shows the numbers as a dimmed gutter and highlights the file text without them.
