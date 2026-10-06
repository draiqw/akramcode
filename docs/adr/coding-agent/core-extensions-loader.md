# Extension loader - jiti resolution and registration lifecycle

Source: packages/coding-agent/src/core/extensions/loader.ts

## Compat entrypoint routing for backward compatibility

Extensions import the akramcode-ai root via the compat entrypoint (a strict superset of the core entrypoint) rather than the core API. This ensures existing extensions using the old global API keep working at runtime until compat is deprecated.

## Pre-binding provider registration queue

During extension loading, provider registrations are queued in the runtime rather than applied immediately. Once bindCore() is called, all queued registrations are flushed to the model registry. bindCore() replaces the queued methods with direct calls to the registry.
