# Codemode Renderer Design

Source: packages/coding-agent/src/extensions/codemode/renderer.ts

## Drop script header from output display

The "Script completed" or "Script failed" header with wall time and "Output:" prefix is programmatically added to results but is redundant in the UI. Dropping it keeps the presentation clean while the execution status and timing are shown separately.

## Count wrapped visual lines for truncation

Output truncation limits visual (wrapped) lines displayed, not logical lines. Script output is often a single long JSON line that wraps multiple times, so limiting logical lines would be misleading.

## Show file path in collapsed preview

When a script's output is truncated and shown in collapsed mode, the truncation notice that normally appears at the end is hidden. To maintain visibility, the temp file path is shown above the truncated output.
