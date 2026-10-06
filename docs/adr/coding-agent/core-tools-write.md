# Write Tool File Operations
Source: packages/coding-agent/src/core/tools/write.ts

## Abort Signal Handling
Abort event listeners should not reject, as this would release the mutation queue while a filesystem operation is still in flight. Instead, check the signal after each await to observe aborts while keeping the queue locked until the operation completes.
