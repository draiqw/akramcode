# Custom Editor Component

Source: packages/coding-agent/src/modes/interactive/components/custom-editor.ts

## Escape Key Handling with Autocomplete

The escape key only triggers the interrupt handler when autocomplete is not active. When autocomplete is showing, escape is passed to the parent editor class to handle autocomplete cancellation instead.

## Exit Key Only When Empty

The Ctrl+D (exit) keybinding only triggers when the editor is empty. If the editor contains text, Ctrl+D falls through to the editor's delete-char-forward handler for standard text editing behavior.

## History Binding Precedence

Explicit history bindings (Ctrl+P/Ctrl+N for previous/next history) take precedence over app actions when the editor is focused. This allows users to bind these keys for history navigation even though they have default app action meanings elsewhere.
