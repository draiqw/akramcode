import type { AkramCodeMessagesOptions } from "./api/akramcode-messages.ts";
import type { AnthropicOptions } from "./api/anthropic-messages.ts";
import type { OpenAICodexResponsesOptions } from "./api/openai-codex-responses.ts";
import type { OpenAICompletionsOptions } from "./api/openai-completions.ts";
import type { OpenAIResponsesOptions } from "./api/openai-responses.ts";

declare module "@akramcode/ai/types" {
	interface ApiOptionsMap {
		"anthropic-messages": AnthropicOptions;
		"openai-completions": OpenAICompletionsOptions;
		"openai-responses": OpenAIResponsesOptions;
		"openai-codex-responses": OpenAICodexResponsesOptions;
		"akramcode-messages": AkramCodeMessagesOptions;
	}
}

/** Marker re-exported from the package entry so the augmentation above is always loaded. */
export type ApiOptionsAugmented = true;
