# Context Overflow Detection

Source: packages/ai/src/utils/overflow.ts

## Overflow Detection Patterns

Overflow patterns detect context window exceeded errors from different providers. Patterns include Anthropic ("prompt is too long: X tokens > Y maximum"), OpenAI ("exceeds the context window"), Google Gemini ("input token count exceeds the maximum"), xAI/Grok ("maximum prompt length"), Groq, Cerebras, Mistral, OpenRouter, Together AI, llama.cpp, LM Studio, DashScope/Qwen, z.ai, Xiaomi MiMo, and others. These patterns catch both explicit error messages and silent overflows detected via usage.input exceeding the context window. Xiaomi MiMo is detected via stopReason "length" with zero output when input fills the context window.

## Non-Overflow Patterns

Patterns like "rate limit" and "too many requests" indicate throttling or rate-limiting errors, not context overflow. These must be excluded from overflow detection to avoid misclassifying transient throttling as overflow, which would prevent appropriate retry logic.
