# Colors

Source: packages/tui/src/colors.ts

## Gamut Mapping Preserves Hue

Hue is held fixed during gamut mapping so the direction vector (cos/sin of hue angle) is computed once and reused across the bisection loop, scaled by different chroma values. This avoids redundant trigonometric calculations.

## Achromatic Fallback for Out-of-Gamut Colors

When no color fits within sRGB gamut even at zero chroma, the algorithm falls back to the achromatic (grayscale) equivalent. This guarantees every color has a valid sRGB representation without requiring special error handling.
