# Alternate-Screen TUI

Source: packages/tui/src/tui-alt-screen.ts

## Terminal Word Selection Behavior

In regular terminal mode, double-click selection is delegated to the terminal emulator. In fullscreen mode, the TUI owns mouse selection and must mirror common terminal word-selection behavior. Keep paths and kebab-case identifiers whole by treating `/` and `-` as word joiners during selection, rather than word boundaries.

## Multiplexer-Aware Mouse Tracking

Multiplexers (tmux, screen, Zellij) can lag if every pointer movement is forwarded through them. When running inside a multiplexer, enable button-motion-only mouse tracking mode to reduce message volume while preserving clicks, wheel events, text selections, and scrollbar drags. Detect multiplexers via environment variables (`TMUX`, `STY`, `ZELLIJ`) or terminal name (`TERM`).

## SGR Mouse Button Code Modifiers

In SGR mouse protocol, bit 3 (value 8) in the button field encodes the Alt modifier. Extract and apply this flag when parsing wheel events to calculate the correct scroll delta.

