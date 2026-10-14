// Adapted from pi-antigravity v0.10.0, commit d59d22b. MIT; see LICENSE.
import { createHash } from "node:crypto";
import type { ExtensionAPI, ProviderModelConfig } from "@akramcode/coding-agent";
import type { ModelsStoreEntry, RefreshModelsContext } from "@akramcode/providers/compat";
import { getApiKey, loginAntigravity, refreshAntigravityToken } from "./auth/oauth.ts";
import { DEFAULT_ENDPOINT, fetchAvailableModelsCatalog, parseApiKey } from "./client/client.ts";
import {
	FALLBACK_MODELS,
	isChatModelId,
	modelEnumsFromCatalog,
	modelsFromCatalog,
	PROVIDER_ID,
	PROVIDER_NAME,
	restoreModelEnums,
} from "./models/models.ts";
import { streamAntigravity } from "./stream/stream.ts";
import { ANTIGRAVITY_API } from "./types/types.ts";

type GeminiModelsStoreEntry = ModelsStoreEntry & { modelEnums?: Record<string, string>; accountScope?: string };

export async function refreshModels(context: RefreshModelsContext): Promise<ProviderModelConfig[]> {
	context.signal.throwIfAborted();
	const credentials = context.credential?.type === "oauth" ? parseApiKey(getApiKey(context.credential)) : undefined;
	const accountScope = credentials ? createHash("sha256").update(credentials.projectId).digest("hex") : undefined;
	const candidate = context.stored as GeminiModelsStoreEntry | undefined;
	const stored = accountScope && candidate?.accountScope === accountScope ? candidate : undefined;
	const cached = stored?.models.filter((model) => isChatModelId(model.id)) as ProviderModelConfig[] | undefined;
	if (!(await context.publish({ update: () => restoreModelEnums(stored?.modelEnums) })))
		return cached ?? FALLBACK_MODELS;
	if (!context.allowNetwork || !credentials) return cached ?? FALLBACK_MODELS;
	const checkedAt = stored?.checkedAt;
	if (!context.force && cached && checkedAt && Date.now() - checkedAt < 4 * 60 * 60 * 1000) return cached;
	const { data } = await fetchAvailableModelsCatalog(credentials.token, credentials.projectId, context.signal);
	const models = modelsFromCatalog(data.models ?? {});
	const modelEnums = modelEnumsFromCatalog(data.models ?? {});
	context.signal.throwIfAborted();
	const persist: GeminiModelsStoreEntry = {
		models: models.map((model) => ({
			...model,
			api: ANTIGRAVITY_API,
			provider: PROVIDER_ID,
			baseUrl: DEFAULT_ENDPOINT,
		})),
		checkedAt: Date.now(),
		modelEnums,
		accountScope,
	};
	await context.publish({
		persist,
		update: () => restoreModelEnums(modelEnums),
	});
	return models;
}

export default function gemini(akramcode: ExtensionAPI): void {
	akramcode.registerProvider(PROVIDER_ID, {
		name: PROVIDER_NAME,
		baseUrl: DEFAULT_ENDPOINT,
		api: ANTIGRAVITY_API,
		models: FALLBACK_MODELS,
		refreshModels,
		oauth: {
			name: PROVIDER_NAME,
			isSubscription: true,
			usesCallbackServer: true,
			login: loginAntigravity,
			refreshToken: refreshAntigravityToken,
			getApiKey,
		},
		streamSimple: streamAntigravity,
	});
}
