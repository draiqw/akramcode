import { envApiKeyAuth } from "@akramcode/ai/auth/helpers";
import { createProvider, type Provider } from "@akramcode/ai/models";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { XIAOMI_TOKEN_PLAN_CN_MODELS } from "./xiaomi-token-plan-cn.models.ts";

export function xiaomiTokenPlanCnProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "xiaomi-token-plan-cn",
		name: "Xiaomi Token Plan CN",
		baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
		auth: { apiKey: envApiKeyAuth("Xiaomi Token Plan CN API key", ["XIAOMI_TOKEN_PLAN_CN_API_KEY"]) },
		models: Object.values(XIAOMI_TOKEN_PLAN_CN_MODELS),
		api: openAICompletionsApi(),
	});
}
