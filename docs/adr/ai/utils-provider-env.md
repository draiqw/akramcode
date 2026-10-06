# Provider Environment Resolution

Source: packages/ai/src/utils/provider-env.ts

## Bun Sandbox Environment Fallback

Bun compiled binaries can expose an empty process.env inside Linux sandboxes even though /proc/self/environ contains the actual environment. This fallback reads /proc/self/environ directly when process.env is empty, duplicating the logic from packages/coding-agent/src/bun/restore-sandbox-env.ts. Since the ai package can be used directly without that entrypoint, provider env lookup must not depend on process.env being pre-patched.
