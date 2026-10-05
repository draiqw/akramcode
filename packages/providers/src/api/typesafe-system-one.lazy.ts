import type { ProviderClassifier } from "@akramcode/ai/types";

export const typesafeSystemOneApi = (): ProviderClassifier => ({
	classify: async (model, context, options) =>
		(await import("./typesafe-system-one.ts")).classify(model, context, options),
});
