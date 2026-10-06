# Streamable HTTP Transport

Source: packages/mcp/src/transports/streamable-http.ts

## Unbound fetch for Cloudflare Workers compatibility

We store fetch in a local variable and assign it to this.fetch through a wrapper function without a receiver. If we called fetch through `this.fetch(...)` or passed `context.fetch(...)`, it would bind the transport or auth context as `this`, which Cloudflare Workers reject for the platform fetch API with "Illegal invocation" error.

## Deferred GET stream initialization

The server-to-client GET stream may only open once the session is initialized. Attempting to open it earlier would fail. Therefore, we start the stream only after the notifications/initialized request succeeds.

## SSE resumption priming events

Server-Sent Events without data content prime stream resumption. These events carry no message but allow the client to recover using Last-Event-ID. Other event types (non-"message") are not JSON-RPC and should be skipped.

## Stream health detection during idle periods

A stream that stays open for a while, even with no events received, indicates the server is healthy. Resetting the retry counter during idle periods prevents unnecessary reconnections to healthy streams.
