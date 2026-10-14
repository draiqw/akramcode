# Session HTML Export

Source: packages/coding-agent/src/core/export-html/index.ts

## Theme Export Colors

The export uses explicit theme colors when available from `getThemeExportColors()`. If not provided, it derives colors from the base `userMessageBg` color to ensure the exported HTML has appropriate visual hierarchy and contrast.

## Session Data Encoding

Session data is Base64 encoded before insertion into the HTML template to avoid complex escaping issues when embedding JSON directly into the HTML document.

## Template-Rendered Tools

A set of tools (bash, read, write, edit, ls) are rendered directly by the HTML template itself rather than being pre-rendered through the TUI-to-ANSI-to-HTML pipeline. These tools have built-in template renderers for better performance and control.

## Conditional Tool Rendering

Custom tool renderings are only included in the export if they actually produced output. This avoids bloating the exported HTML with empty tool render records.
