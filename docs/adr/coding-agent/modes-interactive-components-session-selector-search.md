# Session Selector Search
Source: packages/coding-agent/src/modes/interactive/components/session-selector-search.ts

## Token Mode with Quote Support
Quoted strings are treated as exact phrases rather than fuzzy matches, allowing users to search for multi-word terms without requiring all words to appear consecutively. Example: `foo "node cve" bar` splits into fuzzy "foo", phrase "node cve", fuzzy "bar".

## Quote Unbalancing Fallback
When quotes are unbalanced, fall back to simple whitespace tokenization to avoid treating quote characters as meaningful delimiters. This provides graceful degradation for incomplete user input.

## Recent Mode Ordering
Recent mode filters sessions by query match but preserves their original order, allowing chronological browsing within search results.

## Relevance Mode Scoring
Relevance mode sorts by match score (lower is better) and breaks ties by modification date (most recent first), surfacing recently-active matches ahead of older ones with equal scores.
