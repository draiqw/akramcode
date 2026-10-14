# OpenAI Codex Responses API

Source: packages/providers/src/api/openai-codex-responses.ts

## Request Body Compression with Zstd

The Codex backend accepts zstd-compressed request bodies on the SSE responses endpoint (the same endpoint the official Codex client compresses against), reducing bandwidth usage for large payloads.

## SSE Path Compression

Request body compression is performed once for the SSE path. The WebSocket transport uses uncompressed JSON frames to match the official Codex client behavior, making compression an SSE-specific optimization.

## Codex Store Parameter Workaround

ChatGPT Codex Responses API rejects `store: true` with "Store must be set to false". WebSocket continuation state still works via connection-scoped `previous_response_id` without the store parameter, providing stateful continuity without API compliance issues.
