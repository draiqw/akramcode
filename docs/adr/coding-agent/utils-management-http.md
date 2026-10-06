# Management HTTP Utilities

Source: packages/coding-agent/src/utils/management-http.ts

## Response Body Cancellation

When retrying a failed request, the response body must be cancelled to allow connection reuse. If cancellation itself fails, the error is silently ignored because the response is already being discarded and a retry will follow.
