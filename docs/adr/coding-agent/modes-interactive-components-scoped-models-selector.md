# Scoped Models Selector Component
Source: packages/coding-agent/src/modes/interactive/components/scoped-models-selector.ts

## EnabledIds Design Pattern
Use null to represent "all enabled" state, avoiding the need to enumerate every model ID. An explicit array is used only when filtering specific models, collapsing back to null when all models are re-enabled.

## Focusable IME Support Pattern
The focused property delegates to the search input to enable proper IME (Input Method Editor) cursor positioning in terminal environments.
