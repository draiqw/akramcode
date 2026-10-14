# Edit Tool

Source: packages/coding-agent/src/core/tools/edit.ts

## Model JSON serialization quirks

Some models (Opus 4.6, GLM-5.1) send edits as a JSON string instead of an array. Others send a single edit object instead of a one-element edits array. The tool normalizes these variations to handle models that don't follow the schema exactly.

## Abort handling during file operations

Do not reject from an abort event listener when a filesystem operation is in flight. Instead, check signal.aborted after each await to observe aborts while keeping the mutation queue locked until the operation settles. This prevents releasing the queue while I/O may still complete.

## BOM stripping for fuzzy matching

Strip BOM before text matching because the model will not include an invisible BOM in the oldText it provides for replacement.
