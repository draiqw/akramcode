# Editor Component Architecture

Source: packages/tui/src/components/editor.ts

## Paste Marker Segmentation

Editor handles large pastes by inserting atomic markers like `[paste #1 +123 lines]` instead of raw content. The segmenter merges marker graphemes into single units so cursor movement treats them atomically. Non-matching IDs aren't merged, creating a fast path when no valid pastes exist.

## Wrap Opportunity Concept

Word wrapping tracks positions where line breaks are allowed: after whitespace before non-whitespace, or at CJK character boundaries where either side allows breaking. Multiple consecutive spaces join into one break point after the last space.

## Atomic Segment Visual Wrapping

Single grapheme units wider than maxWidth (paste markers in narrow terminals) are re-wrapped at grapheme granularity for display. The segment remains logically atomic for cursor movement and editing; the split is purely visual for word-wrap layout.

## Autocomplete Trigger Boundaries

Unquoted completions end at whitespace or CJK punctuation; quoted paths may contain either. Trigger tokens may be wrapped in prose (e.g., `"(@src/foo"` or `` `@src/foo ``) so the pattern accounts for leading punctuation.

## Render Geometry Caching

Last render geometry (visible line count, layout width) is stored for cursor navigation hit-testing and mouse click positioning without re-rendering on every query.

## Large Paste Tracking

Pastes over 10 lines or 1000 characters are tracked in a registry and replaced with compact markers in the editor. Full content is retrieved only on submission or expansion, reducing memory and improving UI responsiveness for pasted code blocks.

## Bracketed Paste Buffering

Terminal bracketed paste mode (ESC [200~ ... ESC [201~) accumulates input until the end marker, then processes the complete paste. Handles terminals that split large pastes across multiple input events.

## History Navigation State

When browsing history with up/down arrows, historyIndex is -1 (not browsing) or 0+ (position in history, 0 = most recent). A draft is captured when first entering browse mode so users can return to unsaved input.

## Kill Ring for Emacs Operations

Emacs-style kill/yank commands (Ctrl+K, Ctrl+Y, Alt+Y) maintain a ring buffer of deleted text. Yank pastes the most recent; yank-pop cycles backward through the ring.

## Sticky Column for Vertical Movement

Preferred visual column is preserved during vertical cursor moves to maintain visual position alignment when lines have varying lengths. When moving to a shorter line, the preferred position is cached to restore alignment if moving to a longer line.

## Cursor Snapping from Atomic Segments

When cursor lands in the middle of a multi-grapheme atomic segment (paste marker), it snaps to the segment start so it gets highlighted. The pre-snap column is stored to resolve to the correct visual column on the next vertical move, handling wraps and resizes correctly.

## Layout Width with Padding

With padding, the cursor can overflow into the margin; without padding, one column is reserved for the cursor. Layout width is adjusted to account for cursor column constraints.

## Maximum Visible Lines

Visible lines are capped at 30% of terminal height (minimum 5 lines) to balance editor height against space for autocomplete and other UI elements.

## Hardware Cursor Marker for IME

When focused, a zero-width hardware cursor marker (CURSOR_MARKER) is emitted before the fake cursor so the TUI can position the actual cursor for IME candidate-window placement, even when autocomplete (slash-command menu) is visible.

## Hardware Cursor Position

The hardware cursor marker provides IME positioning without moving the fake cursor, allowing IME menus to anchor to the real cursor while autocomplete lists display independently.

## No Side Borders Design

Editor renders horizontal lines (top/bottom borders) but not vertical borders, relying on padding for visual separation. This minimizes line noise and works better with text selection and copy/paste interactions.

## Mouse Event Handling Architecture

Press, drag, and release events are left unhandled so the renderer's screen-level text selection can run over editor rows (drag to select, release to copy). The renderer synthesizes a click when press and release land on the same cell without movement, which positions the cursor.

## Cursor Position Clamping

For word-wrapped segments, cursor can be at length (end position) only on the last segment of a logical line. Non-last segments clamp to length-1 to stay within the segment.

## Word-Wrapped Chunks Cursor Handling

For word-wrapped chunks, cursor belongs in a chunk if within range [startIndex, endIndex). On non-last chunks, cursor is clamped to text length in case it was in trimmed whitespace at the end.

## Atomic Segment Snapping

Cursor is snapped to atomic segment boundaries (paste markers) so it never lands in the middle of a multi-grapheme unit. Single-grapheme segments don't need snapping.

## Continuation Segment Skipping

When moving down and the segment started on a previous visual line (already visited), skip all continuation visual lines and land on the first visual line past the segment.

## Segment Start Snapping

When cursor lands in an atomic segment, snap to the segment start so it gets highlighted. The pre-snap position is stored so the next vertical move can resolve to the correct visual column.

## Sticky Column Decision Logic

Complex decision matrix: preferred column is set/cleared based on whether cursor was clamped to line end, whether target line is shorter, and whether rewrapping occurred. This preserves intuitive vertical navigation behavior across wraps and resizes.

## Undo Coalescing Strategy

Consecutive word character inputs coalesce into one undo unit (fish-shell style). Space captures state before itself, so undo removes the space and following word together. Each space is separately undoable for fine-grained control.

## Terminal Control Sequence Workaround

Some terminals (e.g., tmux popups with extended-keys-format=csi-u) re-encode control bytes in bracketed paste as CSI-u Ctrl+letter sequences (ESC [codepoint;5u). These are decoded back to literal bytes so newlines are preserved instead of leaking the printable tail.

## File Path Space Insertion

When pasting a file path (starting with /, ~, or .) and the character before the cursor is a word character, prepend a space for readability. Prevents `foo/path` when pasting `/path` after typing `foo`.

## Paste Marker Renumbering

When a paste marker is deleted, registry entries with higher IDs are shifted down in ascending order, independent of marker order in the text. All markers with IDs greater than the removed one are renumbered to maintain compact sequential IDs.

## Cursor Snap Resolution

When cursor was snapped to an atomic segment start, the pre-snap column is resolved against the visual line it belongs to. This gives correct visual column even after resize reshuffles visual lines.

## Non-Last Segment Clamping

For non-last segments of word-wrapped lines, visual column is clamped to length-1 to keep cursor within the segment boundary, maintaining correct visual positioning for wrapped text.

## Autocomplete Sync on Cursor Movement

Open autocomplete pickers are updated when cursor moves because cursor movement changes the text before the cursor, making a picker computed for the old position stale. Without this, arrowing into a partial command name leaves stale suggestions showing.

## Slash Menu Constraint

Slash-command menu is only allowed on the first line of the editor to avoid mixing command suggestions with multi-line input and to keep the UI simple.

## Preserve Kill Action on Word Delete

When deleting words, lastAction is saved before cursor movement methods (moveWordBackwards/moveWordForwards reset it) to allow kill ring accumulation across multiple word deletes.
