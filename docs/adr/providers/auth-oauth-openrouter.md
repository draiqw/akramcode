# OpenRouter OAuth PKCE Flow

Source: packages/providers/src/auth/oauth/openrouter.ts

## Random path instead of OAuth state parameter

OpenRouter does not send an OAuth `state` parameter in its callback. Instead, a random UUID is used in the callback path itself to ensure that stray requests from other login attempts do not accidentally complete a sign-in with the wrong state.
