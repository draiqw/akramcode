# Box Component

Source: packages/tui/src/components/box.ts

## Unpadded Child Lines for Cache Efficiency

Child components return the same string objects across frames. The cache compares child lines by reference (fast identity check); adding padding would create new strings, forcing slow character-by-character comparison on every render.

## Direct Background Application

Once a line is padded to target width, the background is applied directly without re-measuring. The final width is already known, avoiding redundant visibleWidth calculation.
