# Model Selector Component
Source: packages/coding-agent/src/modes/interactive/components/model-selector.ts

## Snapshot-first loading strategy
Load models from the current snapshot immediately to show a responsive UI, then refresh from remote sources in the background. This provides instant feedback while the catalog is updated asynchronously.

## Selector position on filter changes
When a search query is entered, move the selector to the first item (top row) to highlight the best match. When the query is cleared, keep the selector at its previous position, clamped to the restored list length. This balances discoverability with user expectation.
