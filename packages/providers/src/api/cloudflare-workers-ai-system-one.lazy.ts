import type { ProviderClassifier } from "@akramcode/ai/types";

export const cloudflareWorkersAISystemOneApi = (): ProviderClassifier => ({
	classify: async (model, context, options) =>
		(await import("./cloudflare-workers-ai-system-one.ts")).classify(model, context, options),
});
