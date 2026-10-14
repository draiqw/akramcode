# Tree Selector Component

Source: packages/coding-agent/src/modes/interactive/components/tree-selector.ts

## Horizontal Viewport Panning Strategy

Pan horizontally only when needed to keep enough selected-row content visible after its anchor point. The tree gutter is always kept visible as navigation context, and row bodies are clipped.

## Indentation Rules

Three indentation levels have distinct behaviors: at level 0, stay at 0 unless parent has multiple children (then +1); at level 1, children always move to level 2 for visual grouping of subtrees; at levels 2+, single-child chains stay flat but branch points cause +1 indentation.

## Post-Order Traversal for Active Leaf Detection

Use iterative post-order traversal instead of recursion to determine which subtrees contain the active leaf (to sort current branch first). This approach avoids stack overflow on deep trees while preserving priority ordering.

## Child Ordering by Active Path

Order children so the branch containing the active leaf comes first. This makes the current path easier to find visually in branched conversations.

## Gutter Positioning for Tree Indentation

Gutters mark ancestor branch points in the tree. Only add gutter entries when connectors are actually displayed (not suppressed for virtual root children). Place gutters at the connector's position (displayIndent - 1) to align vertical tree guides.

## Selection Preservation During Filtering

When filter results change, preserve selection by finding the nearest visible entry. Walk up the parent chain if needed, or fall back to the last entry. This allows switching between filter modes without losing context.
