# Wheel scroll acceleration constants

Source: packages/tui/src/wheel-scroll.ts

## Burst gap tolerance for multi-notch events

Events closer than 5ms indicate either a single physical notch from Ghostty or high-resolution wheel input. These should move one line per event without acceleration, preserving the user's intentional slow scrolling.

## Reference gap for proportional acceleration

The 100ms baseline maps one event per line. Faster event sequences scale proportionally—events 50ms apart accelerate to 2 lines, 20ms apart to 5 lines (capped at 6).
