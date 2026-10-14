# Loopback OAuth Callback Handler

Source: packages/providers/src/auth/oauth/callback-server.ts

## Unobserved wait promise rejection handling

The wait promise may never be observed if the wait is cancelled or the server is closed. To prevent unhandled rejection warnings, we attach a no-op catch handler to silently suppress rejections that no caller will handle.
