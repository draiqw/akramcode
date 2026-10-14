# Interactive Mode Architecture

Source: packages/coding-agent/src/modes/interactive/interactive-mode.ts

## Keybindings Manager Storage

The keybindings manager is stored at instance level so it can be injected into custom editors, selectors, and extension UI, ensuring consistent key handling across all components.

## Startup UI Input Handling

Text input is accepted during startup but only interrupt, exit, and submission feedback are enabled, limiting user actions until the full TUI is ready.

## UI Startup Before Extensions

The UI is started before initializing extensions so that extension session_start handlers can use interactive dialogs.

## Header Theme Colors Timing

The header and startup notices must be built after the terminal reports its colors, which concludes after a DA1 reply or 100ms timeout. This ensures theme colors are properly embedded in the text.

## Header On-Demand Rendering

The header is built on-demand so it follows theme changes. Collapsed, it is one line with the name and version; key hints appear only when the startup help is expanded.

## Tool Availability on Startup

fd and rg tools must be available after TUI mounting, with downloads happening non-blocking. Slow downloads are shown as status updates to avoid frozen startup.

## Tool Dependencies

Both fd and rg are needed: fd for autocomplete, rg for grep tool and bash commands.

## Input Handlers Activation

Input handlers are enabled only after managed-tool setup completes, ensuring dependencies are available before user input is processed.

## Extension Initialization Order

Extensions are initialized first so loaded resources appear before messages, giving users immediate visibility into what extensions are available.

## Windows Console Title Workaround

On Windows, npm can overwrite the shared console title while checking extension package versions. AkramCode's title is restored after the startup check completes.

## Tmux Query Robustness

If tmux queries timeout, sandbox, or fail, no warning is shown, allowing graceful degradation in restricted environments.

## Changelog Skip for Resumed Sessions

Changelog display is skipped for resumed/continued sessions because they already have previous messages.

## Changelog Skip for Fresh Installs

On fresh install, the version is recorded but changelog is not shown, avoiding unnecessary output for new users.

## Resource Listing On-Demand Rendering

Resource listing bodies are built on-demand so the display follows theme changes and reflects current state. The listing renders nothing until the startup help is expanded, so the start screen shows only the header.

## Key Handler Setup Location

Key handlers are set up on defaultEditor, using this.editor for text access. This approach works correctly regardless of which editor is active.

## Retry Handler Restoration

When agent starts, the main escape handler is restored if retry handler is still active. Retry success event fires later, but the main handler is needed immediately.

## Signal Handlers During Shutdown

Signal handlers must remain registered until terminal cleanup completes. signal-exit checks the listener list during SIGTERM/SIGHUP dispatch and re-sends the signal if only its own listeners remain.

## Signal-Triggered Shutdown Sequence

On signal (SIGTERM/SIGHUP), extension cleanup (session_shutdown) runs BEFORE touching the terminal. Socket removal doesn't write to tty, so it must not be skipped if terminal restore fails. Dead terminals emit EIO, which triggers emergencyTerminalExit. The idle render loop cannot hot-spin (see #4144).

## Interactive Quit Shutdown Sequence

On interactive quit (Ctrl+D, Ctrl+C, /quit, extension shutdown()), the TUI stops before emitting shutdown events. This prevents extension UI cleanup from repainting the final frame during process exit. Kitty key release events are drained to prevent escape sequences leaking to the parent shell over slow SSH.

## Emergency Terminal Cleanup

When the terminal is gone, normal shutdown is skipped because TUI and extension cleanup can write restore sequences and re-trigger EIO.

## Suspend Event Loop Management

While suspended, an event loop interval keeps Node with ref'ed handles. Without this, stopping the TUI can leave no ref'ed handles, causing process exit on fg before SIGCONT handler restores the terminal.

## SIGINT Handling During Suspend

SIGINT is ignored while suspended so Ctrl+C in the terminal doesn't kill the backgrounded process. The handler is removed on resume.

## Usage Breakdown Grouping

Usage without model attribution is grouped separately so the breakdown reconciles with the session total.

## Session Stats Snapshot

Session stats are snapshot with on-demand text rendering so the display follows theme changes.
