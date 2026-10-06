# Interactive Theme Controller

Source: packages/coding-agent/src/modes/interactive/theme/theme-controller.ts

## Failed Query Fallback

Treat a failed query like a terminal that doesn't report colors. Proceed with an empty response rather than throwing an error.

## Terminal Colors Retention

Last reported colors are retained when a query times out. This preserves previously obtained colors rather than erasing them.

## Color Query Settlement

The terminal color query promise settles when the latest color query (or timeout) completes and its colors have been applied to the theme.
