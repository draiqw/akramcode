# Terminal Image and Capability Detection

Source: packages/tui/src/terminal-image.ts

## Tmux Terminal Capability Handling

Emit OSC 8 hyperlinks only when tmux confirms it forwards them. Image protocols are unreliable under tmux, so we keep `images: null` for tmux environments even if hyperlinks are supported.

## Screen Terminal Limitations

The screen terminal does not forward OSC 8 hyperlinks, so we keep them disabled there despite other terminal features.

## Windows Terminal WT_SESSION Behavior

Windows Terminal does not always set WT_SESSION, for example when hosting cmd.exe launched directly from Win+R. Modern Windows consoles support truecolor; we keep hyperlinks off unless we positively detected support through other means, avoiding false positives.

## Unknown Terminal Conservative Fallback

For unknown terminals, we default to conservative behavior: OSC 8 hyperlinks are rendered invisibly as "just text" on terminals that don't recognize them, which causes the URL to disappear from rendered output. We default to the legacy `text (url)` format unless we have positively identified a hyperlink-capable terminal.
