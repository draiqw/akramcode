# Provider Composition

Source: packages/coding-agent/src/core/provider-composer.ts

## OAuth-Only Providers

Providers that use only OAuth authentication do not get a fabricated API-key login method, keeping the authentication interface focused on the single configured OAuth flow.

## Models.json Chat-Only Definitions

Models defined in models.json and modelOverrides are chat-only by design. Extension-provided model definitions can specify different operation types (chat, image, classifier) and are matched by operation and ID to prevent colliding models from sharing headers across different operation types.

## ModelOverrides Layer Ordering

The models.json modelOverrides layer is the topmost user-configuration layer. It applies once, after custom-model upserts from extension models and legacy OAuth projection, ensuring user overrides always take final precedence.

## Extension OAuth Hook Scope

The extension OAuth credential hook for modifying models operates on chat-only models. Other model types (image, classifier) pass through untouched to avoid modifying non-chat operations.

## Eager Provider Validation

Provider validation happens immediately during registration and reload, not lazily, to report structural errors to callers promptly rather than deferring discovery to first use.
