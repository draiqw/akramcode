# System Theme Module

Source: packages/coding-agent/src/modes/interactive/theme/system-theme.ts

## Mid-Gray Background Relaxation

Mid-gray backgrounds cannot accommodate every contrast level. Use binary search to relax levels minimally; full relaxation (factor 2) always fits any background.

## Body Text Foreground Selection

Body text uses the terminal's own foreground when it's clearly stronger than muted text. Otherwise, use the foreground's hue at minimum readable lightness to preserve the foreground's color identity.

## Body Text Contrast

Body text must reach 4.5:1 WCAG contrast on all surfaces it's drawn on, even when relaxing requirements for mid-gray backgrounds.
