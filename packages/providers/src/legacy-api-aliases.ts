import type { SimpleStreamOptions, StreamFunction } from "@akramcode/ai/types";
import { anthropicMessagesApi } from "./api/anthropic-messages.lazy.ts";
import type { AnthropicOptions } from "./api/anthropic-messages.ts";
import { openAICodexResponsesApi } from "./api/openai-codex-responses.lazy.ts";
import type { OpenAICodexResponsesOptions } from "./api/openai-codex-responses.ts";
import { openAICompletionsApi } from "./api/openai-completions.lazy.ts";
import type { OpenAICompletionsOptions } from "./api/openai-completions.ts";
import { openAIResponsesApi } from "./api/openai-responses.lazy.ts";
import type { OpenAIResponsesOptions } from "./api/openai-responses.ts";

const anthropicMessagesStreams = anthropicMessagesApi();
const openAICodexResponsesStreams = openAICodexResponsesApi();
const openAICompletionsStreams = openAICompletionsApi();
const openAIResponsesStreams = openAIResponsesApi();

/** @deprecated Use `stream` from `@akramcode/providers/api/anthropic-messages` or `anthropicMessagesApi().stream`. */
export const streamAnthropic = anthropicMessagesStreams.stream as StreamFunction<
	"anthropic-messages",
	AnthropicOptions
>;
/** @deprecated Use `streamSimple` from `@akramcode/providers/api/anthropic-messages` or `anthropicMessagesApi().streamSimple`. */
export const streamSimpleAnthropic = anthropicMessagesStreams.streamSimple as StreamFunction<
	"anthropic-messages",
	SimpleStreamOptions
>;

/** @deprecated Use `stream` from `@akramcode/providers/api/openai-codex-responses` or `openAICodexResponsesApi().stream`. */
export const streamOpenAICodexResponses = openAICodexResponsesStreams.stream as StreamFunction<
	"openai-codex-responses",
	OpenAICodexResponsesOptions
>;
/** @deprecated Use `streamSimple` from `@akramcode/providers/api/openai-codex-responses` or `openAICodexResponsesApi().streamSimple`. */
export const streamSimpleOpenAICodexResponses = openAICodexResponsesStreams.streamSimple as StreamFunction<
	"openai-codex-responses",
	SimpleStreamOptions
>;

/** @deprecated Use `stream` from `@akramcode/providers/api/openai-completions` or `openAICompletionsApi().stream`. */
export const streamOpenAICompletions = openAICompletionsStreams.stream as StreamFunction<
	"openai-completions",
	OpenAICompletionsOptions
>;
/** @deprecated Use `streamSimple` from `@akramcode/providers/api/openai-completions` or `openAICompletionsApi().streamSimple`. */
export const streamSimpleOpenAICompletions = openAICompletionsStreams.streamSimple as StreamFunction<
	"openai-completions",
	SimpleStreamOptions
>;

/** @deprecated Use `stream` from `@akramcode/providers/api/openai-responses` or `openAIResponsesApi().stream`. */
export const streamOpenAIResponses = openAIResponsesStreams.stream as StreamFunction<
	"openai-responses",
	OpenAIResponsesOptions
>;
/** @deprecated Use `streamSimple` from `@akramcode/providers/api/openai-responses` or `openAIResponsesApi().streamSimple`. */
export const streamSimpleOpenAIResponses = openAIResponsesStreams.streamSimple as StreamFunction<
	"openai-responses",
	SimpleStreamOptions
>;
