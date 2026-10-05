import { envApiKeyAuth } from "@akramcode/ai/auth/helpers";
import { createProvider, type Provider } from "@akramcode/ai/models";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { ZAI_MODELS } from "./zai.models.ts";

export function zaiProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "zai",
		name: "Z.AI",
		baseUrl: "https://api.z.ai/api/coding/paas/v4",
		auth: { apiKey: envApiKeyAuth("Z.AI API key", ["ZAI_API_KEY"]) },
		models: Object.values(ZAI_MODELS),
		api: openAICompletionsApi(),
	});
}
