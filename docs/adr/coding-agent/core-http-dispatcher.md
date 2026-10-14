# HTTP Dispatcher Configuration
Source: packages/coding-agent/src/core/http-dispatcher.ts

## Override Node's default family attempt timeout
Node's default 250ms timeout can terminate valid connection attempts on high-latency routes. Use 2000ms instead for more reliable connections.

## Preserve CONNECT tunnel behavior across Undici versions
Keep HTTP origins on CONNECT tunnels as they were before Undici 8.7. This maintains compatibility and expected behavior.

## Match fetch and dispatcher implementations
Keep fetch and the dispatcher on the same undici implementation. Node 26.0's bundled fetch can otherwise consume compressed responses through npm undici's dispatcher without decompressing them, causing response.json() failures.

## Handle Undici internal client errors
Undici can emit an internal Client "error" while terminating a mid-stream fetch body. The body stream still rejects through reader.read(); listening to this error only prevents EventEmitter's unhandled "error" special case from crashing the application.
