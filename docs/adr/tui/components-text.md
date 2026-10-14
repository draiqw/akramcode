# Text Component

Source: packages/tui/src/components/text.ts

## Flexible margin reduction under width constraints

When the terminal width is too narrow to accommodate the content with full padding, margins are reduced proportionally to ensure that both content and padding still fit within the available width. This prevents text from being truncated while maintaining visual padding when possible.

## Separated text wrapping and padding stages

Text wrapping is performed first and intentionally preserves ANSI codes but does NOT add padding. Padding is applied in a separate stage after wrapping. This two-stage approach allows ANSI codes to work correctly across line boundaries and ensures padding is applied consistently and efficiently.
