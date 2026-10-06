# Custom Message Component

Source: packages/coding-agent/src/modes/interactive/components/custom-message.ts

## Purple Background for Default Rendering

The default rendering path uses a box with a purple background to distinguish custom messages from user messages, providing visual differentiation in the message stream.

## Custom Renderer First Strategy

The custom renderer is tried first during message rendering because it provides its own complete styled component. If it throws or returns nothing, the fallback is default rendering with the purple box.
