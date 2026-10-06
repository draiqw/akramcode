# SDK Initialization

Source: packages/coding-agent/src/core/sdk.ts

## Default Stream Function Fallback

A default stream function is provided for backward compatibility with extensions that construct Agent instances or invoke low-level agent loops without supplying a streamFn parameter. The Agent core library remains provider-agnostic and does not import akramcode-ai/compat directly, so this default is necessary to support pre-0.81 extension code.
