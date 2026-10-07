# @akramcode/sandbox

Runs akramcode's built-in tools inside an OpenSandbox sandbox instead of on the local machine, and caches the sandbox between turns.

- `createSandboxProvider(settings, { dataDir })` returns a provider, or `undefined` for the local machine.
- `provider.acquire({ sessionId, cwd })` returns a `SandboxRuntime` with `bash` and, in volume mode, `files` operations that plug into the tools' `operations` options. `release()` returns the sandbox for reuse.
- The cache: sandbox per session found by labels, a file lease per session, a persistent shell session, a named volume per session with a daily sweep, and eviction beyond `maxLive`.

The package depends on the `@alibaba-group/opensandbox` SDK. Volume deletion calls `/v1/volumes`, which only the `draiqw/opensandbox` fork of the server provides. See [Run Tools in a Sandbox](../coding-agent/docs/sandbox.md) for setup and settings.
