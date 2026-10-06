# Provider Error Body Normalization

Source: packages/ai/src/utils/error-body.ts

## Provider HTTP Error Normalization

Endpoints behind a proxy/gateway may return non-2xx responses whose body the provider SDK cannot fold into `error.message`. The SDK still carries HTTP status and raw/parsed body, but under SDK-specific field names. This means provider catch blocks reading only `error.message` drop the body entirely. The normalization probes known SDK field shapes (openai, Anthropic, generic statusCode/body errors) and returns a structured error for consistent provider display, with a messageCarriesBody flag to avoid double-printing when the SDK already included the body.
