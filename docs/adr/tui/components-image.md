# Image Component

Source: packages/tui/src/components/image.ts

## Kitty protocol cursor control

For Kitty terminal protocol, the C=1 flag prevents cursor movement after image rendering. Since the TUI layer manages cursor positioning independently, cursor movement is not needed and is explicitly suppressed.

## Multi-line rendering for image height accounting

Images are rendered to multiple empty lines to ensure the TUI accounts for the actual image height in its layout and scrolling calculations, preventing content overlap.

## Sixel image cursor positioning

For Sixel (non-Kitty) terminals, the image is drawn on the last line after moving the cursor up, then the cursor is moved back down. This keeps the TUI cursor accounting within the scroll area boundaries.
