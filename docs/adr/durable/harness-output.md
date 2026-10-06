# Output Buffering and Limits

Source: packages/durable/src/harness/output.ts

## Trailing Newline Line Counting

A trailing newline ends the last line rather than starting another, so line counting logic treats it specially to avoid off-by-one errors in range calculations.

## Byte Window Boundary Handling

When finding the first line starting inside a byte window that would otherwise exceed limits, the algorithm cuts at the last full line boundary within the byte limit, or at a character boundary for single lines that are too long.

## Incomplete Character Buffering

TextDecoder maintains state across chunks for incomplete UTF-8 sequences. Calling `decode()` without arguments flushes incomplete bytes from a previous chunk before decoding the current one.

## Head Retention Early Stop

With head retention, once the stored buffer exceeds the window, nothing past the full window is needed. The buffer stops accepting new content to save memory.

## Tail Retention Window Sliding

When retaining tail content, chunks are dropped when what remains holds more than the window size, plus one, ensuring the window's line start can still be found. Each chunk is dropped exactly once.

## Snapshot Optimization

After taking a snapshot, tail windows never reach back before the current snapshot, so only the kept slice of the current window needs storing. This avoids retaining unnecessary chunks.
