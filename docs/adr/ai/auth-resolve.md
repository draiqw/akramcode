# Auth Resolution

Source: packages/ai/src/auth/resolve.ts

## OAuth Refresh Window Contract

The standard five-minute refresh threshold is an optimization that doesn't impose a provider contract. Explicit callers needing specific token validity (e.g., bearer-token export) require their requested minimum after refresh succeeds.
