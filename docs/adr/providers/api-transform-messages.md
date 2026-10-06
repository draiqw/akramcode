# Message Transformation Utilities

Source: packages/providers/src/api/transform-messages.ts

## Null Content Normalization from Untyped Callers

Null or undefined content from untyped callers (custom tools, hand-built histories, old session files) is normalized to empty arrays so downstream code can reliably depend on the type contract and avoid null checks.

## Redacted Thinking as Opaque Encrypted Content

Redacted thinking blocks contain opaque encrypted content that is only valid for the same model that produced them. Cross-model replay must drop redacted thinking to avoid API errors from sending encrypted payloads to different models.

## Thinking Block Signature Preservation for Same-Model Replay

For same-model replay, thinking blocks with signatures (needed for replay metadata) are kept even if the thinking text is empty, as OpenAI encrypted reasoning is persisted via signatures, not text content.

## Cross-Model Thinking Block Conversion

Thinking blocks from different models are converted to plain text content when the text is non-empty, allowing thinking to be transferred as regular text across model boundaries. Empty thinking blocks are skipped entirely.

## System Message Transparency to Tool-Call Accounting

System messages are transparent to tool-call accounting: a system message landing between a tool call and its results is held back and emitted after the results (including synthetic ones), so it never causes a duplicate result for a call that is answered later.
