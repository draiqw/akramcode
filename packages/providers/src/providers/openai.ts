import { envApiKeyAuth, lazyOAuth } from "@akramcode/ai/auth/helpers";
import { createProvider, type Provider } from "@akramcode/ai/models";
import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import { loadOpenAIChatGPTOAuth } from "../auth/oauth/load.ts";
import { OPENAI_MODELS } from "./openai.models.ts";

export function openaiProvider(): Provider<"openai-responses"> {
	return createProvider({
		id: "openai",
		name: "OpenAI",
		baseUrl: "https://api.openai.com/v1",
		auth: {
			apiKey: envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]),
			oauth: lazyOAuth({
				name: "OpenAI (ChatGPT subscription)",
				isSubscription: true,
				loginLabel: "Sign in with ChatGPT",
				load: loadOpenAIChatGPTOAuth,
			}),
		},
		models: Object.values(OPENAI_MODELS),
		api: openAIResponsesApi(),
	});
}
