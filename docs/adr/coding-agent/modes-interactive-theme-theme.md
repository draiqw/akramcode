# Theme Module

Source: packages/coding-agent/src/modes/interactive/theme/theme.ts

## Terminal Colors Caching

The terminal colors object is never mutated, only replaced, allowing themes to cache resolved colors by object identity without comparing contents.

## Grayscale Rendering

While the system theme query is in flight, render in grayscale to prevent flickering before terminal colors arrive.

## Terminal Color Scheme Fallback

Store the terminal's light/dark report (mode 2031) separately as a fallback for determining appearance when the background color is not reported.

## Precomputed ANSI Sequences

Cache precomputed escape sequences for fg/bg colors in maps so render-path calls remain a simple lookup and concatenation.

## Token Defaults

Tokens set to empty string ("") use the terminal's reported default foreground or background; the colors getter fills them in.

## Faint Tokens

Mark certain foreground tokens to render faint (SGR 2) on top of their color, creating visual distinction tiers without allocating new colors.

## Foreground Text Strength

Use the terminal's own foreground when it reaches the emphasis contrast level; otherwise use its hue at minimum readable lightness.

## Text Contrast Minimum

Body text maintains at least 4.5:1 WCAG contrast on all surfaces, even when relaxing levels for mid-gray backgrounds.

## GlobalThis Sharing

Store theme on globalThis to share across Node and jiti module loaders in dev mode.

## Custom Theme Watching

Only watch custom themes for file changes; built-in and system themes do not need monitoring.

## Stale Timer Ignoring

Ignore timers from previous theme change requests to prevent applying changes if the current theme has switched since scheduling.

## Missing File Tolerance

Keep the last successfully loaded theme active if the file temporarily disappears during editing.

## Silent Reload Errors

Ignore reload errors silently; the file may be in an invalid state while the user edits.
