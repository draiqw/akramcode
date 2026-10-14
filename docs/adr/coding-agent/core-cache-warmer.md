# Cache Warming Strategy
Source: packages/coding-agent/src/core/cache-warmer.ts

## Refresh Deadline Calculation
Timers can run late due to sleep/event-loop blockage, so we keep half of the planned pre-expiry margin for dispatch latency. A late refresh arriving after this deadline is likely a full-price cache write rather than a cache warm.

## Error Handling in Cache Warming
Cache warming is best-effort and must not affect the active agent run, so errors during refresh are silently caught to prevent interference with the main task.
