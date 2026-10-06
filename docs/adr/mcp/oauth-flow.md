# OAuth Flow

Source: packages/mcp/src/oauth/flow.ts

## Discovery metadata caching

When a configured metadata URL is provided, discovery results are not cached. This allows changes to the metadata URL to apply immediately without reusing stale discovery state.

## Scope fallthrough with logical OR

The scope parameter uses logical OR (`||`), not nullish coalescing (`??`). An empty scope array from `scopes_supported: []` must fall through to the next scope source, unlike a simple falsy check which would stop at undefined.

## Scope persistence in authorization response

OAuth responses without an explicit scope field grant the requested scope (RFC 6749 §5.1). The response scope is recorded during code exchange so that step-up authorization can preserve it. Callers provide authorization request options, so the scope parameter represents what was actually requested.

## Scope preservation in refresh grants

An OAuth refresh without a scope field keeps the scope of the original grant (RFC 6749 §6), not an empty scope. This distinction matters when reusing tokens or performing step-up authorization.
