import { envApiKeyAuth } from "@akramcode/ai/auth/helpers";
import { createProvider, type Provider } from "@akramcode/ai/models";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { ZAI_CODING_CN_MODELS } from "./zai-coding-cn.models.ts";

export function zaiCodingCnProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "zai-coding-cn",
		name: "Z.AI Coding CN",
		baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
		auth: { apiKey: envApiKeyAuth("Z.AI Coding CN API key", ["ZAI_CODING_CN_API_KEY"]) },
		models: Object.values(ZAI_CODING_CN_MODELS),
		api: openAICompletionsApi(),
	});
}
