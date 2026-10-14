# MCP OAuth
Source: packages/coding-agent/src/extensions/mcp/oauth.ts

## Configured URI normalization
When a redirect URI contains an explicit port in the config, it is sent exactly as written since OAuth servers compare it as a string, not as a parsed URL.

## Localhost fallback behavior
The loopback callback uses 127.0.0.1 as the host because browsers fall back to this IP when ::1 (IPv6) refuses connections.

## Lock compromise handling
The lock file's default compromise handler is replaced with a no-op because losing a lock at worst allows two concurrent refreshes to overlap, which is recoverable, whereas throwing would prevent other lock holders from making progress.

## Refresh failure handling
If a token refresh fails, the request proceeds with the old token to let the server decide the outcome with a 401 response, which triggers appropriate error handling or a sign-in prompt.

## Insufficient scope handling
When a server requests more scope (insufficient_scope error), a refresh cannot grant additional permissions without user interaction, so the request fails and triggers the sign-in flow.

## Registered client redirect constraint
A registered OAuth client cannot use a different redirect URI than the one it was registered with, and its tokens belong to that registration, so clearing both prevents using mismatched credentials.

## Scope merging strategy
When stepping up for more scope, the new scope request combines the configured scope, any missing scopes from the server's challenge, and the scope previously granted to preserve accumulated permissions.

## Refresh skips stepup flow
When a server requests more scope (step-up), refresh tokens cannot grant additional permissions, so the full browser authorization flow is required instead of attempting a refresh.
