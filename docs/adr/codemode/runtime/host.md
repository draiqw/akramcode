# Codemode Sandbox Host

Source: packages/codemode/src/runtime/host.ts

## Worker URL Format Detection

The worker URL extension changes based on the runtime. TypeScript sources use `.ts` (for tests and tsx runners), while published distributions use `.js`.

## Cancelled Call Tracking

When a call is already cancelled by `finish()`, the pending map is no longer updated. The record keeps the "cancelled" status because the worker is either gone or going away, so no update message will arrive.
