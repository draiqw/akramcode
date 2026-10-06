# Easter Egg 3D Animation Component
Source: packages/coding-agent/src/modes/interactive/components/easter-egg-3d.ts

## Sliding puzzle animation sequence
After the model spins, blocks slide into neighboring cells in a puzzle-like motion. The animation cycles through shuffles, flies blocks back home, then holds briefly to create a pulsing effect as the 3D model revolves.

## Block jittering prevention
When selecting which block to move in the puzzle, prefer blocks that didn't move recently. This prevents a single block from appearing to jitter in place by ensuring variety in the movement pattern.

## Starfield background
A faint starfield fades in behind the dissolving screen after a few seconds of animation. The stars use subtle braille dots and flicker, with tints leaning toward neutral, blue, gold, and rose to add depth without overwhelming the rotating model.

## Halo effect for light backgrounds
On light terminal backgrounds, the bright background bleeds through the braille cells and washes out the logo colors. A halo effect blurs the logo's colors into neighboring cells, strongest directly under the logo and fading smoothly outward to compensate.

## Spin timing locked to puzzle cycle
The model's rotation is locked to the puzzle cycle, completing exactly one full turn per cycle and facing the camera in the middle of each hold period. This synchronization makes the spinning feel deliberate and readable.

## Spin phase alignment
Extra rotation is applied during the flight animation so that the model finishes complete turns when the assembled logo faces the camera. This ensures viewers see the logo straight-on at regular intervals.

## Yaw lingering at front views
The model's yaw angle matches its rotation phase at whole turns but lingers at those orientations, showing the front face longer. This lets viewers appreciate the fully assembled logo.

## Ray casting optimization
The ray direction through each braille dot changes linearly across screen space relative to the dot position, so it can be stepped per dot rather than recalculated. This optimization reduces per-pixel computation.

## Solid tinting under the logo
Cells under the assembled logo maintain at least their own coverage (not reduced by the halo). This ensures the logo's face stays solidly colored rather than fading into the halo.

## Color quantization for escape sequences
Logo colors are quantized so neighboring cells on the same face usually share a final background color. This reduces ANSI escape code sequences and shrinks the rendered output.

## Flat face lighting
Faces in the 3D model are flat planes, so lighting is computed once per face rather than per-pixel. This significantly reduces per-dot shading overhead.

## Light background specular removal
On light backgrounds, specular highlights that point toward white would disappear, making the logo invisible. So on light backgrounds, faces only get darker than the brand colors; specular highlights are disabled.

## Dissolve time reversal on exit
On entry, the animation runs forward and the screen dissolves into dust. On exit, the dissolve time runs backward, causing the screen to reassemble piece by piece in reverse order. This creates a satisfying symmetry.
