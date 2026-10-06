# Tool Result Images

Source: packages/coding-agent/src/utils/tool-result-images.ts

## Preserving Tool-Generated Images on Processing Failure

When image processing fails, the original unprocessed image block is kept rather than discarded. This preserves tool behavior: tools already produced the image, so a processing failure may just indicate an unavailable backend. Silently deleting the output would change tool semantics unexpectedly.
