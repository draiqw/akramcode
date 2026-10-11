import { type AnyModel, calculateCost, type Usage } from "@akramcode/ai";
import type { FileEntry } from "./session-manager.ts";

/** One billed request: an assistant response or a usage entry such as a cache-warming refresh. */
export interface UsageRecord {
	timestamp: number;
	provider: string;
	model: string;
	usage: Usage;
}

export interface UsageBucket {
	input: number;
	cacheRead: number;
	cacheWrite: number;
	output: number;
	/** Cost at the provider's pay-as-you-go API prices, even when the request ran on a subscription. */
	apiCost: number;
	/** Requests whose model has no known API price; their cost is missing from apiCost. */
	unpriced: number;
}

export interface UsagePeriod {
	label: string;
	/** Records newer than this many days; undefined means all time. */
	days?: number;
}

export const USAGE_PERIODS: readonly UsagePeriod[] = [
	{ label: "7d", days: 7 },
	{ label: "30d", days: 30 },
	{ label: "90d", days: 90 },
	{ label: "All" },
];

/** Minimal model lookup, satisfied by ModelRuntime. */
export interface ApiPriceSource {
	getModel(provider: string, modelId: string): AnyModel | undefined;
	getAllModels(): readonly AnyModel[];
}

/** Providers whose prices stand in for the same model id served elsewhere, e.g. through a subscription. */
const FIRST_PARTY_PROVIDERS = ["openai", "anthropic", "google"];

function hasPrice(model: AnyModel): boolean {
	return model.cost.input > 0 || model.cost.output > 0;
}

/**
 * Model whose API prices apply to a request. The provider's own entry wins when it has prices; otherwise the
 * same model id from a first-party provider, then from any provider. Subscription-only ids (e.g. a custom
 * openai-codex id) thus resolve to the matching OpenAI API model.
 */
export function findApiPriceModel(models: ApiPriceSource, provider: string, modelId: string): AnyModel | undefined {
	const own = models.getModel(provider, modelId);
	if (own && hasPrice(own)) return own;
	const sameId = models.getAllModels().filter((model) => model.id === modelId && hasPrice(model));
	return FIRST_PARTY_PROVIDERS.map((id) => sameId.find((model) => model.provider === id)).find(Boolean) ?? sameId[0];
}

/**
 * Billed requests in a session file. `seen` holds keys of entries already counted, so entries copied into
 * forked or cloned sessions are counted once.
 */
export function collectUsageRecords(entries: readonly FileEntry[], seen?: Set<string>): UsageRecord[] {
	const records: UsageRecord[] = [];
	for (const entry of entries) {
		let record: UsageRecord | undefined;
		if (entry.type === "message" && entry.message.role === "assistant") {
			const message = entry.message;
			record = {
				timestamp: message.timestamp,
				provider: message.provider,
				model: message.responseModel ?? message.model,
				usage: message.usage,
			};
		} else if (entry.type === "usage") {
			record = {
				timestamp: Date.parse(entry.timestamp),
				provider: entry.provider,
				model: entry.model,
				usage: entry.usage,
			};
		}
		// The faux provider only answers tests; its sessions are not real usage.
		if (!record?.usage || record.provider === "faux") continue;
		if (seen) {
			const key = `${entry.id}:${entry.timestamp}`;
			if (seen.has(key)) continue;
			seen.add(key);
		}
		records.push(record);
	}
	return records;
}

export function createUsageBucket(): UsageBucket {
	return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, apiCost: 0, unpriced: 0 };
}

function addRecord(bucket: UsageBucket, record: UsageRecord, models: ApiPriceSource): void {
	const { usage } = record;
	bucket.input += usage.input;
	bucket.cacheRead += usage.cacheRead;
	bucket.cacheWrite += usage.cacheWrite;
	bucket.output += usage.output;
	const model = findApiPriceModel(models, record.provider, record.model);
	if (model) {
		// calculateCost writes into usage.cost; price a copy so the session entry keeps its recorded cost.
		bucket.apiCost += calculateCost(model, { ...usage, cost: { ...usage.cost } }).total;
	} else if (usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0) {
		bucket.unpriced++;
	}
}

export function summarizeUsage(records: readonly UsageRecord[], models: ApiPriceSource): UsageBucket {
	const bucket = createUsageBucket();
	for (const record of records) addRecord(bucket, record, models);
	return bucket;
}

/** Usage per model, most expensive first. */
export function summarizeUsageByModel(
	records: readonly UsageRecord[],
	models: ApiPriceSource,
): { model: string; bucket: UsageBucket }[] {
	const byModel = new Map<string, UsageBucket>();
	for (const record of records) {
		let bucket = byModel.get(record.model);
		if (!bucket) {
			bucket = createUsageBucket();
			byModel.set(record.model, bucket);
		}
		addRecord(bucket, record, models);
	}
	return Array.from(byModel, ([model, bucket]) => ({ model, bucket })).sort(
		(a, b) =>
			b.bucket.apiCost - a.bucket.apiCost ||
			b.bucket.input +
				b.bucket.cacheRead +
				b.bucket.output -
				(a.bucket.input + a.bucket.cacheRead + a.bucket.output),
	);
}

/** Records within a period, measured back from `now`. */
export function filterUsagePeriod(records: readonly UsageRecord[], period: UsagePeriod, now: number): UsageRecord[] {
	if (period.days === undefined) return [...records];
	const since = now - period.days * 24 * 60 * 60 * 1000;
	return records.filter((record) => record.timestamp >= since);
}
