# TUI Core Implementation

Source: packages/tui/src/tui.ts

## Focus Management in Delegating Containers

When a delegating container forwards a mouse event to a child and the child requests focus, the container itself retains keyboard focus as the owner. This prevents the focus from becoming detached if the container later removes the child component (e.g., closing a settings submenu).

## Terminal Color Query with DA1 Marker

The terminal color query includes a trailing Primary Device Attributes (DA1) request because all terminals answer DA1 in order, making it a reliable end-of-sequence marker. This ensures color replies are complete even for terminals that ignore color queries.

## Overlay Rendering Height Calculation

Overlay layout padding excludes the historical `maxLinesRendered` high-water mark to prevent self-reinforcing inflation that would push content into scrollback when the terminal widens.

## Cell Size Response Consumption

Terminal cell size responses must be consumed immediately without blocking other input, as these responses carry dimensions needed for correct image rendering calibration.

## Overlay Visibility Verification

Before routing keyboard input to a focused overlay, its visibility must be re-verified because visibility can change due to terminal resize or a dynamic `visible()` callback.

## Input Routing to Focused Component

All input, including Ctrl+C, is passed to the focused component, which decides how to handle it rather than the TUI making assumptions.

## Keyboard Input Latency Sensitivity

Keyboard input uses immediate rendering instead of the throttled timer path because input latency is critical—even `setTimeout(0)` can delay delivery by a full 16ms tick on Windows.

## Overlay Line Truncation

Before compositing an overlay line, it is defensively truncated to the declared width even though components should already respect this constraint, ensuring correctness regardless.
