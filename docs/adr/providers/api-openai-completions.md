# OpenAI Completions API Integration

Source: packages/providers/src/api/openai-completions.ts

## Reasoning Details as Replay Metadata

Reasoning details from OpenAI are persisted metadata for conversation replay, not streamed deltas sent to the UI. They are accumulated during streaming and serialized atomically when the thinking block completes to maintain coherence across multiple chunks.

## Tool Call ID Normalization for Cross-Provider Compatibility

OpenAI Responses API generates tool call IDs exceeding 400 characters with special characters like pipes, while Anthropic APIs require IDs matching `^[a-zA-Z0-9_-]+$` with a 64-character limit. IDs are normalized by extracting the call ID, sanitizing characters, and hashing when truncation is unavoidable to ensure uniqueness across provider boundaries.

## Reasoning Field Variation Across Providers

Different OpenAI-compatible providers emit reasoning in different fields: `reasoning_content` (llama.cpp), `reasoning` (other endpoints), or `reasoning_text` (custom servers). The code checks fields in priority order and uses the first non-empty value to avoid duplication, particularly with providers like chutes.ai that return multiple variants with identical content.

## Provider-Specific Tool Result Requirements

Some providers reject user messages directly following tool results and require an intermediate synthetic assistant message ("I have processed the tool results.") to bridge the gap. This constraint is tracked per-provider compatibility settings.

## Assistant Content Format Restrictions

Sending assistant content as an array of text blocks `[{type:"text", text:"..."}]` causes some models (e.g., DeepSeek V3.2 via NVIDIA NIM) to mirror the structure literally in output, producing recursive nesting. Standard OpenAI format expects plain string content to avoid this parsing confusion.

## Token Usage Calculation from Mixed Reporting

OpenAI and OpenRouter document cached_tokens as cache-read hits across different placement locations: OpenAI/OpenRouter use `prompt_tokens_details.cached_tokens`, DeepSeek uses `prompt_cache_hit_tokens`, and Kimi uses top-level `cached_tokens`. Cache write tokens are reported separately as `cache_write_tokens` and must not be subtracted from cached_tokens to avoid under-reporting compliant providers.

## Fallback for Providers Omitting Usage in Initial Chunks

Some providers like Moonshot return usage metrics in choice-level objects rather than the standard chunk-level location. A fallback checks `choice.usage` when `chunk.usage` is absent to handle this provider quirk.

## Error Metadata Handling with Normalized Messages

Provider errors already stringified by `normalizeProviderError` are supplemented with raw error metadata only when the stringified version doesn't already include it, avoiding duplication and double-printing of error information.

## Assistant Message Content Nullability

Some providers reject null or undefined content in assistant messages and require empty strings instead. This is tracked as a compatibility flag to normalize across provider implementations.

## Thinking-as-Text Conversion for Non-Standard Models

Models that don't support native thinking blocks are sent plaintext thinking (no XML tags) converted from thinking content blocks to prevent the model from mimicking tag structures that should only be in system messages.

## Reasoning Details Preservation for Legacy Formats

Legacy encrypted reasoning is preserved as a separate tracking mechanism for models that don't support native reasoning_details fields, maintaining compatibility with older session replay formats.

## Reasoning Effort Mapping Per Model

Different thinking level names map to provider-specific effort values (minimal/low/medium/high/xhigh/max). Model definitions include thinkingLevelMap to translate normalized levels to provider-specific strings or disable reasoning entirely via an "off" value.
