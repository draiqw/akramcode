# Retry Policy and Error Classification

Source: packages/ai/src/utils/retry.ts

## Non-Retryable Error Patterns

Error messages matching non-retryable patterns indicate permanent quota/billing exhaustion and should fail immediately without retry. These include OpenCode Go free-tier limits (returned as 429 JSON error types, which are account limits not transient throttles), subscription limit text ("available balance" after usage exhaustion), generic quota/billing terms ("insufficient_quota", "quota exceeded", "out of budget", "billing"), and ChatGPT's subscription-sharing usage limits that reset on longer timescales.

## Retryable Error Patterns

Retryable patterns cover transient provider failures: generic load/capacity messages, rate limiting, HTTP 5xx/429 status codes, upstream wrapper errors (including OpenRouter "Provider returned error"), network/transport failures (connection refused/lost, socket hangs, fetch failures, DNS errors), WebSocket close/error events, premature stream endings (Anthropic and HTTP/2), provider-requested retry delays (which should surface/abort in the outer retry policy), explicit retry guidance from streaming responses, gRPC resource exhaustion, and ChatGPT's temporary usage/user data unavailability. Each category has specific error text from various SDKs, gateways, and frameworks to recognize.
