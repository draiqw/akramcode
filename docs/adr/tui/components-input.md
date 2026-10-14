# Input Component

Source: packages/tui/src/components/input.ts

## Kitty CSI-u protocol decoding order

Kitty terminal protocol sends CSI-u sequences for all keys when the disambiguate flag is set, including plain printable characters encoded as `\x1b[<code>u`. These sequences contain the ESC character (`\x1b`), which would be rejected by the control character filter if checked first. Therefore, Kitty CSI-u decoding must happen before the control character validation.

## Control character filtering

Regular printable input (including Unicode) is accepted, but control characters are explicitly rejected. This includes C0 control characters (0x00-0x1F), DEL (0x7F), and C1 control characters (0x80-0x9F) to prevent unintended terminal manipulation and ensure input stability.
