# Keyboard input handling

Source: packages/tui/src/keys.ts

## Bracketed paste detection

Bracketed paste markers are checked before interpreting key release and repeat events. This prevents pasted content containing patterns like ":3F" (e.g., Bluetooth MAC addresses) from being mistakenly treated as Kitty keyboard protocol events. Terminal.ts wraps all paste content with `\x1b[200~` markers, making this check reliable.

## Base layout key fallback

When Kitty protocol reports a non-Latin codepoint (not a-z, 0-9, or known symbol), the parser falls back to the base PC-101 layout key. This allows non-Latin keyboard layouts (Cyrillic, etc.) to match Latin keybindings. However, for recognized Latin letters and symbols, the codepoint is authoritative regardless of physical position. This prevents remapped layouts (Dvorak, Colemak, xremap) from causing false matches where different physical positions could match wrong keys.

## Minus as underscore mapping

The minus key is treated as underscore in control character context because they occupy the same physical key on US keyboards. This allows Ctrl+_ to work even when the shift state is ambiguous in legacy terminals.

## Kitty protocol custom mappings

When Kitty keyboard protocol is active, certain legacy escape sequences are reinterpreted as custom terminal mappings rather than standard sequences. For example, `\x1b\r` represents a terminal-configured mapping (e.g., Kitty's `map shift+enter send_text all \e\r`), not the alt+enter fallback used in legacy mode.

## Alt+enter mode awareness

Alt+enter has different encodings depending on protocol support. In standard mode with Kitty/CSI-u, it comes as a protocol sequence. In legacy mode without Kitty, it comes as `\x1b\r`. The parser checks protocol state to avoid misinterpretation.

## Raw backspace ambiguity

Raw `0x08` (BS) is ambiguous in legacy terminals: Windows Terminal uses it for Ctrl+Backspace, while other terminals use it for plain Backspace. The code prefers explicit Kitty/CSI-u/modifyOtherKeys sequences, falling back to a Windows Terminal heuristic only for raw bytes.

## Non-Latin letter codepoint handling

When parsing printable keys, the base layout key is only used for non-Latin codepoints. For recognized Latin letters, digits, and symbols, the reported codepoint is always authoritative. This prevents remapped keyboards from reporting wrong key names based on QWERTY physical position.
