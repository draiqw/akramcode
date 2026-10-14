# Diff Rendering Component
Source: packages/coding-agent/src/modes/interactive/components/diff.ts

## Single-line intra-line diffing
When exactly one line is removed and one line is added, render them with word-level highlighting to show the precise changes. For multiple removals/additions, show lines as-is without intra-line diffing to avoid visual clutter.
