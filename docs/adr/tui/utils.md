# Terminal Text Layout and ANSI Code Handling

Source: packages/tui/src/utils.ts

## Regex Patterns Match string-width Library

Uses the same Unicode category regexes as the string-width library for consistent terminal width calculation across the ecosystem.

## Terminal Spacing Marks Exception

Unicode spacing marks and non-spacing exceptions in legacy wcwidth tables allocate terminal cells even when attached to base characters; the regex explicitly includes these to avoid width miscalculation.

## Non-Base Character Marks

Some Unicode marks occupy terminal cells without a base character, unlike most combining marks; they must be handled separately in width calculation.

## Regional Indicator Symbol Conservative Width

Regional indicator symbols (U+1F1E6..U+1F1FF) render as full-width emoji in most terminals even when isolated during streaming; keeping width conservative (2) avoids terminal auto-wrap drift that causes misalignment in multi-line output.

## Intl.Segmenter Grapheme Grouping Complexity

Intl.Segmenter groups multiple terminal-spacing code points into one grapheme cluster; must count trailing visible code points (Indic consonants after marks, halfwidth/fullwidth forms, Thai/Lao AM vowels) separately to calculate correct terminal width.

## Fast Path for Common Text

Styled terminal lines (the common case) contain only printable ASCII, tabs, and ANSI codes; fast-path detection skips expensive grapheme segmentation to avoid performance regression on large re-renders after theme changes.

## Single-Pass ANSI Sequence Stripping

Supported ANSI/OSC/APC escape sequence types (CSI styling, OSC hyperlinks, APC cursor markers) are stripped in one pass rather than calling separate regex for each type, reducing allocations.

## OSC 8 Hyperlink Terminator Preservation

Some terminals only make BEL-terminated OSC 8 hyperlinks clickable; even though ST (ESC \) is standard, OAuth URLs use BEL and reopening wrapped lines with ST breaks clickability on the first physical line in those terminals; preserve the original terminator.

## SGR Reset Does Not Affect Hyperlinks

ANSI SGR reset (code 0) clears text attributes but does not close OSC 8 hyperlink state; hyperlink state must be tracked separately and re-opened on the next line if needed.

## Printable ASCII Segmentation Optimization

Printable ASCII characters are single graphemes; skip the Intl.Segmenter for ASCII-only text runs to avoid allocation overhead.

## V8 String Tree Flattening

V8 keeps concatenated strings as a tree until read whole; cached lines kept as such trees retain several times their own size; convert string to number (which reads it whole) to force in-place flattening without changing values.

## Multi-Line ANSI State Tracking

Track ANSI state across literal newlines so styling codes from earlier lines affect content after a break; this prevents style loss or regain when a line wraps.

## Active ANSI Code Prepending

When continuing to a new logical line, prepend active ANSI codes from the previous line so styling carries over seamlessly after breaks.

## Long Token Character-by-Character Breaking

When a single token (word) exceeds available width and cannot wrap earlier, break it grapheme-by-grapheme rather than discard it.

## Underline Reset Only for Line Breaks

Line-end reset clears only underline (not full reset) to preserve background color across line breaks; full reset would lose background context needed for styling continuation.

## Long Token Breaking Delegation

Delegate long-token breaking to breakLongWord function which handles its own ANSI resets; don't apply resets here to avoid duplication.

## No Whitespace Line Start

Do not start a wrapped line with whitespace; discard leading spaces after a line break and rely on tracker to reapply active codes.

## No Reset at Final Line

Do not add reset codes at the end of the final line; caller is responsible for terminal state after the output.

## Trailing Whitespace Line Width Overage

Trailing whitespace in wrapped output can cause visual lines to exceed requested width; trim end-of-line whitespace to honor width constraints.

## Separate ANSI from Visible Content

Separate ANSI codes from visible content before processing because ANSI codes are not grapheme segments; interleaving them with grapheme iteration causes misalignment.

## Skip Empty Graphemes

Skip empty grapheme results to avoid string-width calculation issues; empty segments can appear from grapheme segmentation edge cases.

## No Reset at Final Segment

Do not add reset codes at the end of the final segment in breakLongWord; caller is responsible for state after output.

## ANSI Code Ordering at Boundaries

Keep codes from before the range first, then codes at the boundary; this order ensures styling is applied correctly during range extraction.

## SGR State Tracking for Range Context

Track all SGR codes while processing a line to know styling state at the afterStart boundary; "after" segment inherits styling from before the overlay region for visual continuity.

## Include ANSI After Styling Applied

Only include ANSI codes in the "after" segment after styling has been prepended; this avoids duplicate styling application.

## Inherited Styling in Overlay "After" Segment

On first visible grapheme in the "after" portion, prepend inherited styling from before the overlay region so text after an overlay maintains the correct style context.

## Early Exit for Segment Extraction

Exit extraction early when "before" is satisfied (afterLen <= 0) or both segments are done (afterEnd reached); this avoids unnecessary iteration over remaining line content.
