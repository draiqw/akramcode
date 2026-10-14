import { describe, expect, it } from "vitest";
import { createMetrics } from "../src/bench/metrics.ts";
import { compareArms, formatMarkdown, pairRuns, type ReportMeta, summarize } from "../src/bench/report.ts";
import type { RunResult } from "../src/bench/runner.ts";

function run(
	instanceId: string,
	arm: string,
	rep: number,
	pass: boolean,
	tokens: number,
	extra: Partial<RunResult> = {},
): RunResult {
	const metrics = createMetrics();
	metrics.usage = { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, total: tokens, cost: tokens / 1e6 };
	metrics.turns = 3;
	return {
		runId: `${instanceId}~${arm}~r${rep}`,
		instanceId,
		taskId: instanceId.split("@")[0],
		variant: instanceId.includes("@") ? instanceId.split("@")[1] : null,
		category: instanceId.startsWith("long") ? "long" : "bugfix",
		language: "python",
		arm,
		rep,
		startedAt: "2026-01-01T00:00:00.000Z",
		wallMs: 1000,
		agentExitCode: 0,
		timedOut: false,
		pass,
		testExitCode: pass ? 0 : 1,
		testTimedOut: false,
		filesChanged: 1,
		metrics,
		harnessError: null,
		workspace: null,
		...extra,
	};
}

const meta: ReportMeta = {
	createdAt: "2026-01-01T00:00:00.000Z",
	provider: "openai-codex",
	model: "gpt-6-luna",
	reps: 2,
	instances: ["a", "b", "long-x@compact"],
	arms: [
		{ name: "base", build: "release v1", settings: {} },
		{ name: "cand", build: "source", settings: { $compactAtTokens: 30000 } },
	],
	nonInferiorityMargin: 0.1,
};

// Same pass/fail outcomes on both arms; the candidate uses 30% fewer tokens.
const results: RunResult[] = [];
for (const instanceId of meta.instances) {
	for (const rep of [1, 2]) {
		const pass = !(instanceId === "b" && rep === 2);
		results.push(run(instanceId, "base", rep, pass, 1000));
		results.push(run(instanceId, "cand", rep, pass, 700));
	}
}

describe("pairRuns", () => {
	it("pairs by instance and repetition and skips harness errors", () => {
		const withError = [
			...results,
			run("c", "base", 1, true, 1),
			run("c", "cand", 1, false, 1, { harnessError: "setup" }),
		];
		expect(pairRuns(withError, "base", "cand")).toHaveLength(6);
	});
});

describe("compareArms", () => {
	it("reports equal quality and the token reduction", () => {
		const comparison = compareArms(results, "base", "cand", 0.1);
		expect(comparison.pairs).toBe(6);
		expect(comparison.passRateDelta).toBe(0);
		expect(comparison.mcnemar.pValue).toBe(1);
		expect(comparison.tokensChange).toBeCloseTo(-0.3);
		expect(comparison.tokensChangeCi!.low).toBeCloseTo(-0.3);
		expect(comparison.costChange).toBeCloseTo(-0.3);
		expect(comparison.medianTaskTokensChange).toBeCloseTo(-0.3);
		expect(comparison.verdict).toContain("quality not significantly different");
		// Six concordant pairs are too few to claim non-inferiority.
		expect(comparison.verdict).toContain("cannot rule out a drop of");
		expect(comparison.passRateDeltaCi!.low).toBeLessThan(-0.1);
		expect(comparison.verdict).toContain("total tokens -30%");
	});

	it("claims non-inferiority only with enough concordant pairs", () => {
		const many: RunResult[] = [];
		for (let index = 0; index < 60; index++) {
			const pass = index % 5 !== 0;
			many.push(run(`t${index}`, "base", 1, pass, 100), run(`t${index}`, "cand", 1, pass, 100));
		}
		expect(compareArms(many, "base", "cand", 0.1).verdict).toContain("non-inferior at -10 pp margin");
	});

	it("flags a significant regression", () => {
		const regressed: RunResult[] = [];
		for (let index = 0; index < 8; index++) {
			regressed.push(run(`t${index}`, "base", 1, true, 100), run(`t${index}`, "cand", 1, false, 100));
		}
		const comparison = compareArms(regressed, "base", "cand", 0.1);
		expect(comparison.mcnemar.baselineOnly).toBe(8);
		expect(comparison.verdict).toContain("quality significantly worse");
	});
});

describe("summarize and formatMarkdown", () => {
	it("aggregates per arm, category, and task", () => {
		const errored = run("a", "cand", 3, false, 0, { harnessError: "spawn failed" });
		const summary = summarize([...results, errored], meta);
		const base = summary.arms[0];
		expect(base).toMatchObject({ arm: "base", runs: 6, passes: 5, harnessErrors: 0 });
		expect(summary.arms[1].harnessErrors).toBe(1);
		expect(base.passCi.low).toBeLessThan(base.passRate!);
		expect(summary.categories["long@compact"]).toEqual({
			base: { passes: 2, runs: 2 },
			cand: { passes: 2, runs: 2 },
		});
		expect(summary.tasks.find((row) => row.instanceId === "b")!.arms.base).toMatchObject({ passes: 1, runs: 2 });
		expect(summary.harnessErrors).toEqual([{ runId: "a~cand~r3", error: "spawn failed" }]);

		const markdown = formatMarkdown(summary, [...results, errored]);
		expect(markdown).toContain("## Verdict");
		expect(markdown).toContain("| base | 5/6 | 83.3% |");
		expect(markdown).toContain("harness: spawn failed");
		expect(markdown).toContain("Arm `base` (baseline)");
	});
});
