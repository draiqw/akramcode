import type { AnyModel, AssistantMessage, Usage } from "@akramcode/ai";
import { describe, expect, test } from "vitest";
import type { FileEntry } from "../src/core/session-manager.ts";
import {
	type ApiPriceSource,
	collectUsageRecords,
	filterUsagePeriod,
	findApiPriceModel,
	summarizeUsage,
	summarizeUsageByModel,
	USAGE_PERIODS,
} from "../src/core/usage-stats.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

function model(provider: string, id: string, input: number, output: number, cacheRead = 0): AnyModel {
	return { provider, id, cost: { input, output, cacheRead, cacheWrite: 0 } } as AnyModel;
}

const models: ApiPriceSource = {
	getModel: (provider, id) => all.find((m) => m.provider === provider && m.id === id),
	getAllModels: () => all,
};
const all = [
	model("openrouter", "gpt-5.5", 6, 36),
	model("openai", "gpt-5.5", 5, 30, 0.5),
	model("openai", "cheap", 1, 2),
];

function usage(input: number, output: number, cacheRead = 0): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite: 0,
		totalTokens: input + output + cacheRead,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function assistantEntry(id: string, provider: string, modelId: string, daysAgo: number, u: Usage): FileEntry {
	const timestamp = NOW - daysAgo * DAY;
	const message = { role: "assistant", provider, model: modelId, usage: u, timestamp, content: [] };
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: new Date(timestamp).toISOString(),
		message: message as unknown as AssistantMessage,
	} as FileEntry;
}

describe("usage stats", () => {
	test("prices subscription-only ids at the first-party API price", () => {
		expect(findApiPriceModel(models, "openai-codex", "gpt-5.5")?.provider).toBe("openai");
		expect(findApiPriceModel(models, "openrouter", "gpt-5.5")?.provider).toBe("openrouter");
		expect(findApiPriceModel(models, "openai-codex", "unknown")).toBeUndefined();
	});

	test("sums tokens and API cost per period and model, counting copied entries once", () => {
		const seen = new Set<string>();
		const original = [
			assistantEntry("a", "openai-codex", "gpt-5.5", 1, usage(1_000_000, 100_000, 2_000_000)),
			assistantEntry("b", "openai", "cheap", 40, usage(1_000_000, 0)),
			assistantEntry("c", "faux", "faux-1", 1, usage(5, 5)),
			assistantEntry("d", "openai-codex", "unknown", 200, usage(10, 10)),
		];
		const records = [
			...collectUsageRecords(original, seen),
			// A fork copies entries with their ids and timestamps.
			...collectUsageRecords(original.slice(0, 1), seen),
		];
		expect(records).toHaveLength(3);

		const [week, , quarter, allTime] = USAGE_PERIODS.map((p) =>
			summarizeUsage(filterUsagePeriod(records, p, NOW), models),
		);
		// 1M input * $5 + 100k output * $30 + 2M cache read * $0.5 = $9
		expect(week).toMatchObject({ input: 1_000_000, output: 100_000, cacheRead: 2_000_000, unpriced: 0 });
		expect(week.apiCost).toBeCloseTo(9);
		expect(quarter.apiCost).toBeCloseTo(10);
		expect(allTime.unpriced).toBe(1);

		expect(summarizeUsageByModel(records, models).map((m) => m.model)).toEqual(["gpt-5.5", "cheap", "unknown"]);
		// Pricing a copy leaves the recorded cost alone.
		expect(records[0]!.usage.cost.total).toBe(0);
	});
});
