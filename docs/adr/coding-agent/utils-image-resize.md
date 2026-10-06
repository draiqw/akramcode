# Image Resize Worker

Source: packages/coding-agent/src/utils/image-resize.ts

## Buffer Transfer Semantics

Transferable bytes must be copied to avoid detaching the caller's buffer. Creating a new Uint8Array while passing the buffer to the worker ensures the caller retains access to their original data.

## Bun Worker Path Resolution

Bun compiled executables resolve worker entry points by string path rather than URL objects. The string path `./src/utils/image-resize-worker.ts` allows the release binary to use an embedded worker instead of falling back to in-process resizing.
