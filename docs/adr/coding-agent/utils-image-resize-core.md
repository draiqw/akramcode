# Image resizing and encoding

Source: packages/coding-agent/src/utils/image-resize-core.ts

## Anthropic size headroom

The default max bytes is set to 4.5MB of base64 payload, providing buffer below Anthropic's 5MB limit for encoded image data.
