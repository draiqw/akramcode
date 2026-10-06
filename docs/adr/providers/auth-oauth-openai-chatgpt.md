# OpenAI ChatGPT OAuth Flow

Source: packages/providers/src/auth/oauth/openai-chatgpt.ts

## Dynamic client registration per login

OpenAI's public-client flow requires no client secret. Each login registers a new client with a fixed ID, and OpenAI returns the issued client ID in the callback for use during token exchange.

## Early token expiry margin

Token refresh occurs 3 minutes before the real expiry to ensure no request starts with a token about to expire, avoiding race conditions and request failures.

## ID token presence check

AkramCode does not use the ID token to identify users or read profile data. The presence check is kept as part of the token-response contract with OpenAI to catch malformed responses.

## Spare connection handling on callback completion

The HTTP callback server's `close()` method stops accepting new connections but leaves existing ones open. Browsers pre-open spare connections, and one without a sent request remains attached to the closed server. A subsequent login in the same process starts a new server with a new state, but the browser may reuse that spare connection and send the new login's callback over it. The old server then rejects it as a "state mismatch" before the new login sees it. We call `closeAllConnections()` to forcibly close all connections, preventing this race.
