# Main-Screen TUI

Source: packages/tui/src/tui-main-screen.ts

## Reset Max Lines on Full Clear

When doing a full render with clear, reset `maxLinesRendered` to the current line count. When doing a full render without clear, track the maximum line count ever rendered to account for terminal buffer growth. This distinction ensures proper cleanup of scrollback when intentionally clearing versus normal incremental rendering.

## Termux Height Change Handling

Termux changes terminal height when the software keyboard appears or disappears, triggering `heightChanged` conditions frequently. Unlike desktop terminals, a full redraw causes the entire history to replay on each toggle, creating visual artifacts. Therefore, allow height-change-only renders (without full clear) on Termux to preserve scrollback.

## Clear on Shrink with Overlay Constraint

When content shrinks below the working area and no overlays are active, perform a full re-render to clear empty rows. Overlays need the padding, so this optimization only applies when no overlays are currently active. Controlled via `setClearOnShrink()`.

## Differential Rendering Viewport Constraint

Differential rendering can only update lines that were visible in the previous frame. If the first changed line is above the previous viewport top, a full redraw is necessary because the change is outside the renderable area.

## Cursor Position Tracking Split

`cursorRow` tracks the end of content (used for viewport calculation on next render), while `hardwareCursorRow` tracks the actual hardware cursor position in the terminal (used for cursor movement commands). Keeping them separate allows efficient incremental rendering.

## Terminal Working Area Tracking

`maxLinesRendered` tracks the maximum line count ever rendered during this session. The terminal's buffer grows but doesn't shrink unless explicitly cleared. This tracks the working area high-water mark to distinguish between shrinking (which needs clearing) and growth (which doesn't).

