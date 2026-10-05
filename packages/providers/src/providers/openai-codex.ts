import { lazyOAuth } from "@akramcode/ai/auth/helpers";
import { createProvider, type Provider } from "@akramcode/ai/models";
import { openAICodexResponsesApi } from "../api/openai-codex-responses.lazy.ts";
import { loadOpenAICodexOAuth } from "../auth/oauth/load.ts";
import { OPENAI_CODEX_MODELS } from "./openai-codex.models.ts";

export function openaiCodexProvider(): Provider<"openai-codex-responses"> {
	return createProvider({
		id: "openai-codex",
		name: "OpenAI Codex (legacy)",
		baseUrl: "https://chatgpt.com/backend-api",
		auth: {
			oauth: lazyOAuth({
				name: "OpenAI (ChatGPT Plus/Pro)",
				isSubscription: true,
				load: loadOpenAICodexOAuth,
			}),
		},
		models: Object.values(OPENAI_CODEX_MODELS),
		api: openAICodexResponsesApi(),
	});
}
