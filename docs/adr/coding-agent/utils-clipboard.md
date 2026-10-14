# System clipboard text operations

Source: packages/coding-agent/src/utils/clipboard.ts

## Native writer precedence over OSC 52

Direct writes using native clipboard APIs precede OSC 52 emission so the terminal cannot race with the native writer. Linux tools retain clipboard selection ownership after the call returns, preventing conflicts.

## Display-aware OSC 52 fallback

OSC 52 cannot be programmatically verified by the client. On desktop sessions with a display, we report clipboard write failures instead of silently succeeding. Without a display (containers, WSL without WSLg), the terminal is the only clipboard route, so we always attempt OSC 52. Remote sessions always emit it to reach the client clipboard.
