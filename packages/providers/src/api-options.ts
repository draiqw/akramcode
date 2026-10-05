import type { AkramCodeMessagesOptions } from "./api/akramcode-messages.ts";
import type { AnthropicOptions } from "./api/anthropic-messages.ts";
import type { AzureOpenAIResponsesOptions } from "./api/azure-openai-responses.ts";
import type { BedrockOptions } from "./api/bedrock-converse-stream.ts";
import type { GoogleOptions } from "./api/google-generative-ai.ts";
import type { GoogleVertexOptions } from "./api/google-vertex.ts";
import type { MistralOptions } from "./api/mistral-conversations.ts";
import type { OpenAICodexResponsesOptions } from "./api/openai-codex-responses.ts";
import type { OpenAICompletionsOptions } from "./api/openai-completions.ts";
import type { OpenAIResponsesOptions } from "./api/openai-responses.ts";

declare module "@akramcode/ai/types" {
	interface ApiOptionsMap {
		"anthropic-messages": AnthropicOptions;
		"openai-completions": OpenAICompletionsOptions;
		"openai-responses": OpenAIResponsesOptions;
		"openai-codex-responses": OpenAICodexResponsesOptions;
		"azure-openai-responses": AzureOpenAIResponsesOptions;
		"google-generative-ai": GoogleOptions;
		"google-vertex": GoogleVertexOptions;
		"mistral-conversations": MistralOptions;
		"bedrock-converse-stream": BedrockOptions;
		"akramcode-messages": AkramCodeMessagesOptions;
	}
}

/** Marker re-exported from the package entry so the augmentation above is always loaded. */
export type ApiOptionsAugmented = true;
