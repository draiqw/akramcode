import { envApiKeyAuth } from "@akramcode/ai/auth/helpers";
import { createProvider, type Provider } from "@akramcode/ai/models";
import { mistralConversationsApi } from "../api/mistral-conversations.lazy.ts";
import { MISTRAL_MODELS } from "./mistral.models.ts";

export function mistralProvider(): Provider<"mistral-conversations"> {
	return createProvider({
		id: "mistral",
		name: "Mistral",
		baseUrl: "https://api.mistral.ai",
		auth: { apiKey: envApiKeyAuth("Mistral API key", ["MISTRAL_API_KEY"]) },
		models: Object.values(MISTRAL_MODELS),
		api: mistralConversationsApi(),
	});
}
