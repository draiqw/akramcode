import type { ProviderClassifier } from "@akramcode/ai/types";

export const llamaCppClassifyApi = (): ProviderClassifier => ({
	classify: async (model, context, options) =>
		(await import("./llama-cpp-classify.ts")).classify(model, context, options),
});
