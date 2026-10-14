# Anthropic Messages API Integration

Source: packages/providers/src/api/anthropic-messages.ts

## Claude Code Tool Naming

Tool names are normalized to match Claude Code's canonical casing (Read, Write, Edit, Bash, etc.) to maintain compatibility when running through OAuth tokens under the Claude Code identity.

## Deferred Tool Placeholder for Cache Preservation

A reserved placeholder tool is declared from the first request when native tool changes are enabled. Anthropic adds hidden prompt scaffolding for mid-conversation tool changes; keeping this placeholder in the cached prefix prevents cache invalidation on the first actual tool change, measured to eliminate the full-miss penalty.

## Federation Client Caching and Token Reuse

The Anthropic SDK caches federated access tokens per client, but akramcode creates one client per request. A single federation client is cached for the current configuration and fetch implementation, then cloned per request with `withOptions()` to share the token cache and avoid redundant token exchanges.

## Early Token Usage Capture

Initial token usage is captured from the `message_start` event rather than computed later, ensuring input token counts are available even if the stream aborts early before `message_delta` arrives.

## Streaming Scratch Buffer Cleanup

Partial JSON accumulation (`partialJson`) and other streaming scratch buffers are never persisted in the final message; they are internal only and stripped before storing for replay, keeping the message shape consistent with non-streaming contexts.

## Proxy Compatibility for Usage Updates

Usage fields are updated conditionally—only when present in the event, not when null—to preserve input tokens from `message_start` when HTTP proxies or gateways omit them in `message_delta`, a known behavior of some routing layers.

## Vercel AI Gateway TTL Breakdown

Vercel AI Gateway includes cache creation TTL breakdown in delta events despite the SDK only typing it on `message_start`. Fallback is implemented to read it from either location to capture all cache metadata.

## Reasoning Token Tracking

Reasoning tokens are reported by Anthropic as a subset of output tokens rather than separate, extracted from `output_tokens_details` when available to track extended thinking usage independently.

## Total Tokens Calculation

Anthropic does not provide `total_tokens` in responses; it is computed from components (input + output + cache_read + cache_write) to maintain consistent usage reporting.

## Native Tool Changes and Cache Survival

When native tool changes are enabled, the initial tools remain active with a cache breakpoint on the last tool, followed by the deferred placeholder. Later tool changes are defined by value in `tool_addition` blocks and revoked by `tool_removal`, keeping the cached prefix intact across every tool change.

## Redacted Thinking Protocol

Redacted thinking blocks (encrypted reasoning) are passed back to Anthropic as `redacted_thinking` with their opaque payload to enable multi-turn reasoning continuity without exposing thinking content.

## Empty Thinking Signatures

When a thinking signature is missing or empty (e.g., from stream abort or compatibility mode), it is converted to plain text for compatible providers that cannot accept thinking blocks without signatures, while models marked as supporting empty signatures preserve the block structure.
