# Terminal

Source: packages/tui/src/terminal.ts

## Bracketed Paste Mode

Wrap pasted input with `\x1b[200~` and `\x1b[201~` markers so terminal emulators signal paste events separately from regular input. This allows the TUI to distinguish pastes and apply different handling (e.g., disabling autocompletion or rate-limiting).

## Refresh Terminal Dimensions on Suspend/Resume

After process suspension (Ctrl+Z), the terminal's SIGWINCH signal is lost while stopped. On resume, dimensions may be stale. Proactively send SIGWINCH to this process to synchronize dimensions. Unix-only, best-effort; some restricted environments (seccomp, LSM) block this.

## Windows Virtual Terminal Input Mode

On Windows, add `ENABLE_VIRTUAL_TERMINAL_INPUT` (0x0200) to stdin console mode so the terminal sends VT escape sequences (e.g., `\x1b[Z` for Shift+Tab) instead of raw console events that lose modifier state. Without this flag, Shift+Tab arrives as plain `\t`. Must run after `setRawMode(true)` because that function resets console mode flags.

## Kitty Keyboard Protocol Progressive Enhancement

Query the terminal for Kitty keyboard protocol support (flags: 1=disambiguate, 2=report events, 4=alternate keys). The query includes a device-attributes sentinel (`\x1b[c`) so terminals that don't support Kitty will reply quickly, allowing fast fallback to modifyOtherKeys without a startup timeout.

## Paste Content Re-wrapping

When paste events fire from StdinBuffer, wrap the content with bracketed-paste markers (`\x1b[200~...~\x1b[201~`) so existing editor input handlers recognize it as a paste, not individual keystrokes.

## Disable Kitty Protocol Before Input Drain

Before draining pending stdin (to avoid losing input after SSH or suspend), disable Kitty keyboard protocol first. Otherwise, late key-release events may generate new Kitty escape sequences, leaking into the parent shell over slow connections.

## Pause Stdin Before Restoring Raw Mode

Before restoring the terminal's raw mode state on exit, pause stdin to prevent any buffered input (e.g., Ctrl+D) from being reinterpreted after raw mode is disabled. This prevents a race condition where Ctrl+D could close the parent shell over SSH if processed after the TUI exits.

