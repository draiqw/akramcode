# Startup UI

Source: packages/coding-agent/src/cli/startup-ui.ts

## Theme Loading Error Handling

Startup prompts must not crash when a theme fails to load. Diagnostic errors are reported separately by the resource loader, so theme loading errors in the startup phase should be silently skipped to avoid interrupting the setup flow.

## Terminal Color Regeneration

The terminal color query regenerates the system theme during startup. Re-rendering after colors arrive rebuilds the dialog with the newly generated theme to ensure the UI displays correct colors.
