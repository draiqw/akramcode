// Adapted from pi-antigravity v0.10.0, commit d59d22b. MIT; see ../LICENSE.
import type { ProviderModelConfig } from "@akramcode/coding-agent";
import type { ModelInfoRaw, ThinkingWire } from "../types/types.ts";
import { isRecord } from "../utils/util.ts";

export const PROVIDER_ID = "gemini";
export const PROVIDER_NAME = "Google Gemini (subscription)";
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const modelEnums = new Map<string, string>();

export function isChatModelId(id: string): boolean {
	return /^(gemini-|claude-|gpt-oss-)[\w.-]+$/i.test(id) && !/image/i.test(id);
}

/** Only enum identifiers belong in the persisted protocol metadata. */
export function modelEnumsFromCatalog(raw: Record<string, ModelInfoRaw>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(raw).flatMap(([id, info]) =>
			isChatModelId(id) &&
			info.isInternal !== true &&
			typeof info.model === "string" &&
			/^[A-Z][A-Z0-9_]{0,255}$/.test(info.model)
				? [[id, info.model]]
				: [],
		),
	);
}

export function snapshotModelEnums(): Record<string, string> {
	return Object.fromEntries(modelEnums);
}

export function restoreModelEnums(raw: unknown): void {
	modelEnums.clear();
	if (!isRecord(raw)) return;
	for (const [id, value] of Object.entries(raw)) {
		if (isChatModelId(id) && typeof value === "string" && /^[A-Z][A-Z0-9_]{0,255}$/.test(value))
			modelEnums.set(id, value);
	}
}

/** Unverified bootstrap entry: lets the host offer /login before catalog discovery. */
export const FALLBACK_MODELS: ProviderModelConfig[] = [
	{
		id: "gemini-3.1-pro-low",
		name: "Gemini subscription (sign in to discover models)",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 1048576,
		maxTokens: 65535,
	},
];

/** Keep the exact runtime IDs returned by Google; no guessed aliases or extra models. */
export function modelsFromCatalog(raw: Record<string, ModelInfoRaw>): ProviderModelConfig[] {
	const models: ProviderModelConfig[] = [];
	for (const [id, info] of Object.entries(raw)) {
		if (info.isInternal === true || !isChatModelId(id)) continue;
		const label = [info.displayName, info.label, info.modelName].find((value) => typeof value === "string" && value);
		models.push({
			id,
			name: typeof label === "string" ? label : id,
			reasoning: info.supportsThinking === true,
			input: info.supportsImages === true ? ["text", "image"] : ["text"],
			cost: ZERO_COST,
			contextWindow: id.startsWith("gemini-") ? 1048576 : 128000,
			maxTokens: getMaxOutputTokens(id),
		});
	}
	return models.sort((a, b) => a.id.localeCompare(b.id));
}

export function getModelEnum(id: string): string | undefined {
	return modelEnums.get(id);
}

export function getMaxOutputTokens(id: string, runtimeModel = id): number {
	if (runtimeModel.startsWith("claude-")) return 64000;
	if (runtimeModel.startsWith("gpt-oss-")) return 32768;
	if (runtimeModel.startsWith("gemini-")) return runtimeModel.includes("pro") ? 65535 : 65536;
	return 8192;
}

export function getThinkingConfig(id: string, effort: string | undefined): ThinkingWire | undefined {
	if (!/^(gemini-|claude-|gpt-oss-)/.test(id)) return undefined;
	if (!effort || effort === "off") return { includeThoughts: false, thinkingBudget: 0 };
	if (id.startsWith("claude-")) return { includeThoughts: true, thinkingBudget: 1024 };
	if (id.startsWith("gpt-oss-")) return { includeThoughts: true, thinkingBudget: 8192 };
	return {
		includeThoughts: true,
		thinkingBudget: effort === "high" || effort === "xhigh" ? -1 : effort === "medium" ? 4000 : 1000,
	};
}
