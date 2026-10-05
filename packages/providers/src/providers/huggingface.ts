import { envApiKeyAuth } from "@akramcode/ai/auth/helpers";
import { createProvider, type Provider } from "@akramcode/ai/models";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { HUGGINGFACE_MODELS } from "./huggingface.models.ts";

export function huggingfaceProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "huggingface",
		name: "Hugging Face",
		baseUrl: "https://router.huggingface.co/v1",
		auth: { apiKey: envApiKeyAuth("Hugging Face token", ["HF_TOKEN"]) },
		models: Object.values(HUGGINGFACE_MODELS),
		api: openAICompletionsApi(),
	});
}
