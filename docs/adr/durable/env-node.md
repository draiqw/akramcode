# Node.js Execution Environment

Source: packages/durable/src/env/node.ts

## Async spawn error consumption

Spawning a child process can emit "error" events asynchronously even after spawn() returns. We consume these to prevent crashing the Node.js process when initialization fails after the spawn call.

## Explicit byte positions for read retry

Text line reading tracks explicit byte positions across read operations. This allows an aborted read to be safely retried without skipping bytes that were buffered but not yet yielded.

## Best-effort file closing

File closing is performed best-effort: we catch and ignore all errors. This includes closing after cancellation or when an earlier I/O operation has already failed, ensuring the file handle is released regardless of prior errors.

## Separate decoders per stream

One TextDecoder is used per stream (stdout/stderr), not shared. This ensures a character split across chunks of one stream is correctly handled and survives interleaving with the other stream's chunks.

## No output after exec settles

Once exec() has settled (returned to caller), no further output is emitted. This is critical because a descendant process might hold stdio open, causing output to arrive after the caller thinks the command is complete.

## Output tracking before spill

Output seen before spill activation is tracked separately (seenBytes, seenNewlines) so it can be counted against thresholds to decide whether to start spilling, and kept as a prefix to be written once spilling begins.

## Signal-to-exit-code mapping

When a process is killed by a signal (e.g., OOM killer), Node.js provides no exit code. We map this to the conventional `128 + signal number` so callers do not mistake it for a successful exit with code 0 or a normal error.
