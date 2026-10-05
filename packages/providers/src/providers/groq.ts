import { envApiKeyAuth } from "@akramcode/ai/auth/helpers";
import { createProvider, type Provider } from "@akramcode/ai/models";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { GROQ_MODELS } from "./groq.models.ts";

export function groqProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "groq",
		name: "Groq",
		baseUrl: "https://api.groq.com/openai/v1",
		auth: { apiKey: envApiKeyAuth("Groq API key", ["GROQ_API_KEY"]) },
		models: Object.values(GROQ_MODELS),
		api: openAICompletionsApi(),
	});
}
