import { envApiKeyAuth } from "@akramcode/ai/auth/helpers";
import { createProvider, type Provider } from "@akramcode/ai/models";
import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { FIREWORKS_MODELS } from "./fireworks.models.ts";

export function fireworksProvider(): Provider<"anthropic-messages" | "openai-completions"> {
	return createProvider({
		id: "fireworks",
		name: "Fireworks",
		baseUrl: "https://api.fireworks.ai/inference",
		auth: { apiKey: envApiKeyAuth("Fireworks API key", ["FIREWORKS_API_KEY"]) },
		models: Object.values(FIREWORKS_MODELS),
		api: {
			"anthropic-messages": anthropicMessagesApi(),
			"openai-completions": openAICompletionsApi(),
		},
	});
}
