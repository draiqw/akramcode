# Clipboard image format handling

Source: packages/coding-agent/src/utils/clipboard-image.ts

## Wayland/X11 clipboard distinction

On Wayland, undefined return value means the backend failed, while null means the clipboard has no image. An empty Wayland clipboard must not fall through to stale X11 clipboard contents, requiring careful distinction between unavailable backend and empty clipboard.

## Linux empty/unavailable preservation

When in WSL, we preserve Linux's empty/unavailable distinction instead of falling through to stale Windows clipboard contents if the Linux backends return empty.
