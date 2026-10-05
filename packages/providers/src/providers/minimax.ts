import { envApiKeyAuth } from "@akramcode/ai/auth/helpers";
import { createProvider, type Provider } from "@akramcode/ai/models";
import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { MINIMAX_MODELS } from "./minimax.models.ts";

export function minimaxProvider(): Provider<"anthropic-messages"> {
	return createProvider({
		id: "minimax",
		name: "MiniMax",
		baseUrl: "https://api.minimax.io/anthropic",
		auth: { apiKey: envApiKeyAuth("MiniMax API key", ["MINIMAX_API_KEY"]) },
		models: Object.values(MINIMAX_MODELS),
		api: anthropicMessagesApi(),
	});
}
