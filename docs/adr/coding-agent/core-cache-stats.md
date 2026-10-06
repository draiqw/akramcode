# Cache Statistics and Miss Detection
Source: packages/coding-agent/src/core/cache-stats.ts

## Cost Calculation for Cache Misses
Missed tokens are billed at the provider's actual paid rate (input or cacheWrite tier) rather than the cache-read rate. The paid rate is extracted from the current message's cost breakdown, since missed tokens can only land in input or cacheWrite buckets, not cache-read.
