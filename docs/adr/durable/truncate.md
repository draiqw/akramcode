# Truncation Utilities - Limit Detection

Source: packages/durable/src/truncate.ts

## Line vs byte limit detection logic

When no byte break has occurred, only the presence of omitted lines proves the line limit was reached. Otherwise a trailing newline exceeded the byte limit.
