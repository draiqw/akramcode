# Core Type Definitions

Source: packages/ai/src/types.ts

## StreamFunction Contract

The StreamFunction type has specific requirements for implementations: it must receive a normalized transcript where system prompt and tools are in the leading system message (never on the context), return an AssistantMessageEventStream, and handle auth errors synchronously before returning a stream. All request/model/runtime failures after stream return must be encoded in the stream itself. Error termination must produce an AssistantMessage with either "error" or "aborted" stopReason and an errorMessage field.
