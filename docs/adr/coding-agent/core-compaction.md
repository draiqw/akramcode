# Session Compaction

Source: packages/coding-agent/src/core/compaction/compaction.ts

## fromHook Field Compatibility

The `fromHook` field on CompactionEntry is retained for session file backwards compatibility even though it's no longer actively used. Sessions created before this refactoring may still have this field, and removing it would break session loading.

## System Messages as Prompt State

System messages represent the current prompt state, not part of the conversation history. During compaction, they are not included in the messages to summarize; instead, the compaction entry itself carries their state for replay when the session resumes.

## Cache Bypass for Summaries

One-off summarization calls bypass prompt caching with `cacheRetention: "none"` to avoid polluting the cache with temporary summaries. Callers without a session ID receive a fresh routing ID instead of reusing any caller-supplied ID.
