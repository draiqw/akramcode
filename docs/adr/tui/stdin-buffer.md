# StdinBuffer Input Handling

Source: packages/tui/src/stdin-buffer.ts

## WezTerm Escape Key Workaround

WezTerm's `enable_kitty_keyboard` sends the Escape key press as a raw `\x1b` byte and the release as a full Kitty CSI-u sequence, concatenated as `\x1b\x1b[27;...u`. The buffer normally treats `\x1b\x1b` as a complete meta-key sequence (ESC + single char), which would leave `[27;...u` to be typed as plain text. If the character after `\x1b\x1b` would begin a new escape sequence, we emit only the first ESC and restart parsing from the second to handle this correctly.
