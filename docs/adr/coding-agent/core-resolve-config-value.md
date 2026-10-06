# Config Value Resolution

Source: packages/coding-agent/src/core/resolve-config-value.ts

## Command Result Caching

Shell command results are cached for the entire process lifetime to avoid redundant executions of the same command within a single agent session.
