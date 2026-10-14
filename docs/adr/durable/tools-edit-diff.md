# Edit Diff Tools - Fuzzy Matching

Source: packages/durable/src/tools/edit-diff.ts

## Fuzzy matching offset semantics

When fuzzy matching is used, offsets are returned in the normalized space. Callers can use the normalized content to compute replacements, then decide how much of that normalized output should be written back to preserve original formatting.
