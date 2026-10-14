# File Mutation Queue - Canonical Paths and Serialization

Source: packages/durable/src/tools/file-mutation-queue.ts

## Canonical path construction

For a file that does not exist yet, use its canonical parent joined with its name. This ensures a write that creates a file and a later mutation of it share one key even under a symlinked directory.

## Mutation serialization

Serialize edit and write mutations of one file within this process by matching file system id and canonical path. Different files and file systems never wait on each other. Concurrent calls on one file run in order their keys resolve. This is not a lock against external processes.
