import { envApiKeyAuth } from "@akramcode/ai/auth/helpers";
import { createProvider, type Provider } from "@akramcode/ai/models";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { CEREBRAS_MODELS } from "./cerebras.models.ts";

export function cerebrasProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "cerebras",
		name: "Cerebras",
		baseUrl: "https://api.cerebras.ai/v1",
		auth: { apiKey: envApiKeyAuth("Cerebras API key", ["CEREBRAS_API_KEY"]) },
		models: Object.values(CEREBRAS_MODELS),
		api: openAICompletionsApi(),
	});
}
