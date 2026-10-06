# Agent

Source: packages/agent/src/agent.ts

## Optional Constructor Arguments for Backward Compatibility

Older compiled consumers of this package may omit the `options` parameter or the `streamFn` property even though the current API requires them. The constructor accepts these as optional to maintain backward compatibility with existing compiled code that was built against an earlier version.
