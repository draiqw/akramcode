# Branch Summarization
Source: packages/coding-agent/src/core/compaction/branch-summarization.ts

## Two-Pass File Operations Collection
File operations are collected in two passes: first pass gathers all ops from all entries including those exceeding token budget, ensuring cumulative tracking from nested branch summaries. Only akramcode-generated summaries (not extension-generated ones) are processed to maintain consistency.

## Summary Entry Token Budget Override
Summary entries (compaction, branch_summary) are treated specially and attempted to fit within the token budget even if they would exceed the limit, as they provide critical context for understanding the abandoned branch.
