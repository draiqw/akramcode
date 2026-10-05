import { envApiKeyAuth } from "@akramcode/ai/auth/helpers";
import { createProvider, type Provider } from "@akramcode/ai/models";
import { googleGenerativeAIApi } from "../api/google-generative-ai.lazy.ts";
import { GOOGLE_MODELS } from "./google.models.ts";

export function googleProvider(): Provider<"google-generative-ai"> {
	return createProvider({
		id: "google",
		name: "Google",
		baseUrl: "https://generativelanguage.googleapis.com/v1beta",
		auth: { apiKey: envApiKeyAuth("Gemini API key", ["GEMINI_API_KEY"]) },
		models: Object.values(GOOGLE_MODELS),
		api: googleGenerativeAIApi(),
	});
}
