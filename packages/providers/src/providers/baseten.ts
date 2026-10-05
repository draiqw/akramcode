import { envApiKeyAuth } from "@akramcode/ai/auth/helpers";
import { createProvider, type Provider } from "@akramcode/ai/models";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { BASETEN_MODELS } from "./baseten.models.ts";

export function basetenProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "baseten",
		name: "Baseten",
		baseUrl: "https://inference.baseten.co/v1",
		auth: { apiKey: envApiKeyAuth("Baseten API key", ["BASETEN_API_KEY"]) },
		models: Object.values(BASETEN_MODELS),
		api: openAICompletionsApi(),
	});
}
