/**
 * Aggregates run results into per-arm statistics, paired comparisons against the baseline arm,
 * and a markdown report.
 *
 * Runs that hit a harness error (fixture setup, spawn failure) are excluded from quality numbers and
 * listed separately: they say nothing about the agent. Agent timeouts and crashes count as failures.
 */

import { addUsage, emptyUsage, type TokenUsage } from "./metrics.ts";
import type { RunResult } from "./runner.ts";
import {
	clusterBootstrap,
	type Interval,
	type McNemarResult,
	mcnemarExact,
	median,
	newcombePairedInterval,
	relativeChange,
	sum,
	wilsonInterval,
} from "./stats.ts";

export interface ArmInfo {
	name: string;
	build: string;
	settings: Record<string, unknown>;
}

export interface ReportMeta {
	createdAt: string;
	provider: string;
	model: string;
	reps: number;
	instances: string[];
	arms: ArmInfo[];
	/** Pass-rate drop (fraction) used for the non-inferiority statement. */
	nonInferiorityMargin: number;
}

export interface ArmSummary {
	arm: string;
	runs: number;
	harnessErrors: number;
	passes: number;
	passRate: number | undefined;
	passCi: Interval;
	timeouts: number;
	runsWithRequestErrors: number;
	usage: TokenUsage;
	compactionUsage: TokenUsage;
	medianTotalTokens: number | undefined;
	medianCost: number | undefined;
	medianWallMs: number | undefined;
	totalWallMs: number;
	medianTurns: number | undefined;
	medianToolCalls: number | undefined;
	medianPeakContext: number | undefined;
	compactions: number;
	runsWithCompaction: number;
	compactionFailures: number;
	toolResultClears: number;
	toolResultsCleared: number;
}

export interface Comparison {
	baseline: string;
	candidate: string;
	pairs: number;
	mcnemar: McNemarResult;
	baselinePassRate: number | undefined;
	candidatePassRate: number | undefined;
	passRateDelta: number | undefined;
	passRateDeltaCi: Interval | undefined;
	tokensChange: number | undefined;
	tokensChangeCi: Interval | undefined;
	inputTokensChange: number | undefined;
	outputTokensChange: number | undefined;
	cacheReadChange: number | undefined;
	costChange: number | undefined;
	costChangeCi: Interval | undefined;
	wallChange: number | undefined;
	/** Median over instances of (candidate median tokens / baseline median tokens) - 1. */
	medianTaskTokensChange: number | undefined;
	verdict: string;
}

export interface TaskRow {
	instanceId: string;
	category: string;
	arms: Record<
		string,
		{
			passes: number;
			runs: number;
			medianTokens: number | undefined;
			medianCost: number | undefined;
			compactions: number;
		}
	>;
}

export interface BenchSummary {
	meta: ReportMeta;
	arms: ArmSummary[];
	comparisons: Comparison[];
	categories: Record<string, Record<string, { passes: number; runs: number }>>;
	tasks: TaskRow[];
	harnessErrors: { runId: string; error: string }[];
}

function valid(results: readonly RunResult[]): RunResult[] {
	return results.filter((result) => result.harnessError === null);
}

export function summarizeArm(arm: string, all: readonly RunResult[]): ArmSummary {
	const mine = all.filter((result) => result.arm === arm);
	const runs = valid(mine);
	const passes = runs.filter((result) => result.pass).length;
	const usage = emptyUsage();
	const compactionUsage = emptyUsage();
	for (const result of runs) {
		addUsage(usage, result.metrics.usage);
		addUsage(compactionUsage, result.metrics.compactionUsage);
	}
	const pick = (select: (result: RunResult) => number) => median(runs.map(select));
	return {
		arm,
		runs: runs.length,
		harnessErrors: mine.length - runs.length,
		passes,
		passRate: runs.length === 0 ? undefined : passes / runs.length,
		passCi: wilsonInterval(passes, runs.length),
		timeouts: runs.filter((result) => result.timedOut).length,
		runsWithRequestErrors: runs.filter((result) => result.metrics.requestErrors > 0).length,
		usage,
		compactionUsage,
		medianTotalTokens: pick((result) => result.metrics.usage.total),
		medianCost: pick((result) => result.metrics.usage.cost),
		medianWallMs: pick((result) => result.wallMs),
		totalWallMs: sum(runs.map((result) => result.wallMs)),
		medianTurns: pick((result) => result.metrics.turns),
		medianToolCalls: pick((result) => result.metrics.toolCalls),
		medianPeakContext: pick((result) => result.metrics.peakContextTokens),
		compactions: sum(runs.map((result) => result.metrics.compactions)),
		runsWithCompaction: runs.filter((result) => result.metrics.compactions > 0).length,
		compactionFailures: sum(runs.map((result) => result.metrics.compactionFailures)),
		toolResultClears: sum(runs.map((result) => result.metrics.toolResultClears)),
		toolResultsCleared: sum(runs.map((result) => result.metrics.toolResultsCleared)),
	};
}

interface Pair {
	instanceId: string;
	baseline: RunResult;
	candidate: RunResult;
}

export function pairRuns(results: readonly RunResult[], baseline: string, candidate: string): Pair[] {
	const key = (result: RunResult) => `${result.instanceId}\u0000${result.rep}`;
	const baseRuns = new Map(
		valid(results)
			.filter((result) => result.arm === baseline)
			.map((result) => [key(result), result]),
	);
	const pairs: Pair[] = [];
	for (const result of valid(results)) {
		if (result.arm !== candidate) continue;
		const base = baseRuns.get(key(result));
		if (base) pairs.push({ instanceId: result.instanceId, baseline: base, candidate: result });
	}
	return pairs.sort((a, b) => a.instanceId.localeCompare(b.instanceId) || a.baseline.rep - b.baseline.rep);
}

function groupByInstance(pairs: readonly Pair[]): Pair[][] {
	const groups = new Map<string, Pair[]>();
	for (const pair of pairs) {
		const group = groups.get(pair.instanceId) ?? [];
		group.push(pair);
		groups.set(pair.instanceId, group);
	}
	return [...groups.values()];
}

function passDelta(groups: readonly Pair[][]): number | undefined {
	const pairs = groups.flat();
	if (pairs.length === 0) return undefined;
	return (
		(pairs.filter((pair) => pair.candidate.pass).length - pairs.filter((pair) => pair.baseline.pass).length) /
		pairs.length
	);
}

function ratioOfTotals(groups: readonly Pair[][], select: (result: RunResult) => number): number | undefined {
	const pairs = groups.flat();
	return relativeChange(
		sum(pairs.map((pair) => select(pair.baseline))),
		sum(pairs.map((pair) => select(pair.candidate))),
	);
}

/**
 * Union of two intervals. The pass-rate delta uses the Newcombe paired score interval (honest at
 * small n, ignores task clustering) and the task-cluster bootstrap (accounts for correlated
 * repetitions, collapses at small n); reporting their envelope keeps the weaker claim.
 */
function envelope(first: Interval | undefined, second: Interval | undefined): Interval | undefined {
	if (!first) return second;
	if (!second) return first;
	return { low: Math.min(first.low, second.low), high: Math.max(first.high, second.high) };
}

const pct = (value: number | undefined, digits = 0): string =>
	value === undefined ? "n/a" : `${(value * 100).toFixed(digits)}%`;
const signedPct = (value: number | undefined, digits = 0): string =>
	value === undefined ? "n/a" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
const signedPp = (value: number | undefined): string =>
	value === undefined ? "n/a" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`;
const ci = (interval: Interval | undefined, format: (value: number) => string): string =>
	interval === undefined ? "n/a" : `[${format(interval.low)}, ${format(interval.high)}]`;

export function compareArms(
	results: readonly RunResult[],
	baseline: string,
	candidate: string,
	margin: number,
): Comparison {
	const pairs = pairRuns(results, baseline, candidate);
	const groups = groupByInstance(pairs);
	const mcnemar = mcnemarExact(
		pairs.map((pair) => ({ baseline: pair.baseline.pass, candidate: pair.candidate.pass })),
	);
	const rate = (select: (pair: Pair) => boolean) =>
		pairs.length === 0 ? undefined : pairs.filter(select).length / pairs.length;
	const totalTokens = (result: RunResult) => result.metrics.usage.total;
	const cost = (result: RunResult) => result.metrics.usage.cost;
	const taskRatios = groups
		.map((group) =>
			relativeChange(
				median(group.map((pair) => pair.baseline.metrics.usage.total)) ?? 0,
				median(group.map((pair) => pair.candidate.metrics.usage.total)) ?? 0,
			),
		)
		.filter((value): value is number => value !== undefined);
	const comparison: Comparison = {
		baseline,
		candidate,
		pairs: pairs.length,
		mcnemar,
		baselinePassRate: rate((pair) => pair.baseline.pass),
		candidatePassRate: rate((pair) => pair.candidate.pass),
		passRateDelta: passDelta(groups),
		passRateDeltaCi: envelope(newcombePairedInterval(mcnemar), clusterBootstrap(groups, passDelta, { seed: 7 })),
		tokensChange: ratioOfTotals(groups, totalTokens),
		tokensChangeCi: clusterBootstrap(groups, (sample) => ratioOfTotals(sample, totalTokens), { seed: 11 }),
		inputTokensChange: ratioOfTotals(groups, (result) => result.metrics.usage.input),
		outputTokensChange: ratioOfTotals(groups, (result) => result.metrics.usage.output),
		cacheReadChange: ratioOfTotals(groups, (result) => result.metrics.usage.cacheRead),
		costChange: ratioOfTotals(groups, cost),
		costChangeCi: clusterBootstrap(groups, (sample) => ratioOfTotals(sample, cost), { seed: 13 }),
		wallChange: ratioOfTotals(groups, (result) => result.wallMs),
		medianTaskTokensChange: median(taskRatios),
		verdict: "",
	};
	comparison.verdict = verdictFor(comparison, margin);
	return comparison;
}

export function verdictFor(comparison: Comparison, margin: number): string {
	const head = `${comparison.candidate} vs ${comparison.baseline}`;
	if (comparison.pairs === 0) return `${head}: no paired runs`;
	const { mcnemar, passRateDelta, passRateDeltaCi } = comparison;
	const rates = `pass ${pct(comparison.candidatePassRate)} vs ${pct(comparison.baselinePassRate)}`;
	const delta = `delta ${signedPp(passRateDelta)}, 95% CI ${ci(passRateDeltaCi, (value) => signedPp(value))}`;
	const p = `McNemar p=${mcnemar.pValue.toFixed(3)}`;
	let quality: string;
	if (mcnemar.pValue < 0.05) {
		quality = `quality significantly ${(passRateDelta ?? 0) > 0 ? "better" : "worse"} (${rates}, ${delta}, ${p})`;
	} else {
		const nonInferior = passRateDeltaCi !== undefined && passRateDeltaCi.low > -margin;
		const power = nonInferior
			? `non-inferior at -${(margin * 100).toFixed(0)} pp margin`
			: `cannot rule out a drop of ${passRateDeltaCi ? (-passRateDeltaCi.low * 100).toFixed(0) : "?"} pp`;
		quality = `quality not significantly different (${rates}, ${delta}, ${p}; ${power})`;
	}
	const tokens = `total tokens ${signedPct(comparison.tokensChange)} (95% CI ${ci(comparison.tokensChangeCi, (value) => signedPct(value))})`;
	const cost = `cost ${signedPct(comparison.costChange)} (95% CI ${ci(comparison.costChangeCi, (value) => signedPct(value))})`;
	return `${head}: ${quality}; ${tokens}; ${cost}; wall time ${signedPct(comparison.wallChange)}`;
}

export function summarize(results: readonly RunResult[], meta: ReportMeta): BenchSummary {
	const armNames = meta.arms.map((arm) => arm.name);
	const arms = armNames.map((arm) => summarizeArm(arm, results));
	const comparisons = armNames
		.slice(1)
		.map((candidate) => compareArms(results, armNames[0], candidate, meta.nonInferiorityMargin));

	const categories: BenchSummary["categories"] = {};
	for (const result of valid(results)) {
		const label = result.variant ? `${result.category}@${result.variant}` : result.category;
		const byArm = categories[label] ?? {};
		categories[label] = byArm;
		const cell = byArm[result.arm] ?? { passes: 0, runs: 0 };
		byArm[result.arm] = cell;
		cell.runs++;
		if (result.pass) cell.passes++;
	}

	const instanceIds = [...new Set([...meta.instances, ...results.map((result) => result.instanceId)])];
	const tasks: TaskRow[] = instanceIds.map((instanceId) => {
		const mine = valid(results).filter((result) => result.instanceId === instanceId);
		const row: TaskRow = { instanceId, category: mine[0]?.category ?? "", arms: {} };
		for (const arm of armNames) {
			const runs = mine.filter((result) => result.arm === arm);
			row.arms[arm] = {
				passes: runs.filter((result) => result.pass).length,
				runs: runs.length,
				medianTokens: median(runs.map((result) => result.metrics.usage.total)),
				medianCost: median(runs.map((result) => result.metrics.usage.cost)),
				compactions: sum(runs.map((result) => result.metrics.compactions)),
			};
		}
		return row;
	});

	return {
		meta,
		arms,
		comparisons,
		categories,
		tasks,
		harnessErrors: results
			.filter((result) => result.harnessError !== null)
			.map((result) => ({ runId: result.runId, error: result.harnessError ?? "" })),
	};
}

const int = (value: number | undefined): string =>
	value === undefined ? "n/a" : Math.round(value).toLocaleString("en-US");
const usd = (value: number | undefined): string => (value === undefined ? "n/a" : `$${value.toFixed(4)}`);
const seconds = (ms: number | undefined): string => (ms === undefined ? "n/a" : `${(ms / 1000).toFixed(1)}s`);

function table(header: string[], rows: string[][]): string {
	const escapeCell = (cell: string) => cell.replace(/\|/g, "\\|");
	return [
		`| ${header.map(escapeCell).join(" | ")} |`,
		`| ${header.map(() => "---").join(" | ")} |`,
		...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
	].join("\n");
}

function pairedInstances(results: readonly RunResult[], comparison: Comparison): string[] {
	return pairRuns(results, comparison.baseline, comparison.candidate).map((pair) => pair.instanceId);
}

export function formatMarkdown(summary: BenchSummary, results: readonly RunResult[]): string {
	const { meta } = summary;
	const lines: string[] = [];
	lines.push("# akramcode quality benchmark", "");
	lines.push(`- Created: ${meta.createdAt}`);
	lines.push(`- Model: ${meta.provider}/${meta.model}`);
	lines.push(`- Repetitions: ${meta.reps}; task instances: ${meta.instances.length}; runs: ${results.length}`);
	for (const [index, arm] of meta.arms.entries()) {
		const settings = Object.keys(arm.settings).length === 0 ? "default settings" : JSON.stringify(arm.settings);
		lines.push(`- Arm \`${arm.name}\`${index === 0 ? " (baseline)" : ""}: ${arm.build}; ${settings}`);
	}
	lines.push("", "## Verdict", "");
	if (summary.comparisons.length === 0) lines.push("Single arm, no comparison.");
	for (const comparison of summary.comparisons) lines.push(`- ${comparison.verdict}`);
	const fewest = Math.min(
		...summary.comparisons.map((comparison) => new Set(pairedInstances(results, comparison)).size),
	);
	if (summary.comparisons.length > 0 && fewest < 10) {
		lines.push(
			"",
			`Warning: only ${fewest} paired task instances. Bootstrap intervals are unreliable below about 10 instances; treat this as a smoke test.`,
		);
	}

	lines.push("", "## Pass rate", "");
	lines.push(
		table(
			["arm", "passed", "pass rate", "95% CI (Wilson)", "timeouts", "runs with request errors", "harness errors"],
			summary.arms.map((arm) => [
				arm.arm,
				`${arm.passes}/${arm.runs}`,
				pct(arm.passRate, 1),
				ci(arm.passCi, (value) => pct(value, 1)),
				String(arm.timeouts),
				String(arm.runsWithRequestErrors),
				String(arm.harnessErrors),
			]),
		),
	);

	lines.push("", "## Tokens, cost, time", "");
	lines.push(
		table(
			[
				"arm",
				"input",
				"cache read",
				"cache write",
				"output",
				"total tokens",
				"cost",
				"median tokens/run",
				"median cost/run",
				"median wall",
				"median turns",
				"median tool calls",
				"median peak context",
			],
			summary.arms.map((arm) => [
				arm.arm,
				int(arm.usage.input),
				int(arm.usage.cacheRead),
				int(arm.usage.cacheWrite),
				int(arm.usage.output),
				int(arm.usage.total),
				usd(arm.usage.cost),
				int(arm.medianTotalTokens),
				usd(arm.medianCost),
				seconds(arm.medianWallMs),
				int(arm.medianTurns),
				int(arm.medianToolCalls),
				int(arm.medianPeakContext),
			]),
		),
	);

	if (summary.comparisons.length > 0) {
		lines.push("", "## Paired comparison against the baseline", "");
		lines.push(
			"Pairs are runs of the same task instance and repetition. The pass-delta CI is the envelope of the Newcombe paired score interval and a bootstrap that resamples whole task instances; token and cost CIs use the bootstrap.",
			"",
		);
		lines.push(
			table(
				[
					"candidate",
					"pairs",
					"base only pass",
					"cand only pass",
					"McNemar p",
					"pass delta (95% CI)",
					"total tokens (95% CI)",
					"input",
					"cache read",
					"output",
					"cost (95% CI)",
					"median per-task tokens",
					"wall",
				],
				summary.comparisons.map((comparison) => [
					comparison.candidate,
					String(comparison.pairs),
					String(comparison.mcnemar.baselineOnly),
					String(comparison.mcnemar.candidateOnly),
					comparison.mcnemar.pValue.toFixed(3),
					`${signedPp(comparison.passRateDelta)} ${ci(comparison.passRateDeltaCi, signedPp)}`,
					`${signedPct(comparison.tokensChange)} ${ci(comparison.tokensChangeCi, (value) => signedPct(value))}`,
					signedPct(comparison.inputTokensChange),
					signedPct(comparison.cacheReadChange),
					signedPct(comparison.outputTokensChange),
					`${signedPct(comparison.costChange)} ${ci(comparison.costChangeCi, (value) => signedPct(value))}`,
					signedPct(comparison.medianTaskTokensChange),
					signedPct(comparison.wallChange),
				]),
			),
		);
	}

	lines.push("", "## Compaction", "");
	lines.push(
		table(
			[
				"arm",
				"runs with compaction",
				"compactions",
				"compaction failures",
				"tool-result clears",
				"tool results cleared",
				"summary tokens",
				"summary cost",
			],
			summary.arms.map((arm) => [
				arm.arm,
				`${arm.runsWithCompaction}/${arm.runs}`,
				String(arm.compactions),
				String(arm.compactionFailures),
				String(arm.toolResultClears),
				String(arm.toolResultsCleared),
				int(arm.compactionUsage.total),
				usd(arm.compactionUsage.cost),
			]),
		),
	);

	const armNames = meta.arms.map((arm) => arm.name);
	lines.push("", "## By category", "");
	lines.push(
		table(
			["category", ...armNames],
			Object.entries(summary.categories)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([category, byArm]) => [
					category,
					...armNames.map((arm) => {
						const cell = byArm[arm];
						return cell ? `${cell.passes}/${cell.runs}` : "-";
					}),
				]),
		),
	);

	lines.push("", "## Per task", "");
	lines.push("Cells: passed/runs, median total tokens, median cost, compactions.", "");
	lines.push(
		table(
			["task", "category", ...armNames],
			summary.tasks.map((row) => [
				row.instanceId,
				row.category,
				...armNames.map((arm) => {
					const cell = row.arms[arm];
					if (!cell || cell.runs === 0) return "-";
					return `${cell.passes}/${cell.runs}, ${int(cell.medianTokens)} tok, ${usd(cell.medianCost)}, ${cell.compactions} cmp`;
				}),
			]),
		),
	);

	const failures = results.filter(
		(result) => result.harnessError === null && (result.metrics.errorMessages.length > 0 || result.timedOut),
	);
	if (failures.length > 0 || summary.harnessErrors.length > 0) {
		lines.push("", "## Errors", "");
		for (const error of summary.harnessErrors)
			lines.push(`- \`${error.runId}\` harness: ${error.error.slice(0, 300)}`);
		for (const result of failures) {
			const parts = [...(result.timedOut ? ["timed out"] : []), ...result.metrics.errorMessages.slice(0, 2)];
			lines.push(`- \`${result.runId}\`: ${parts.join("; ").replace(/\s+/g, " ").slice(0, 300)}`);
		}
	}
	lines.push("");
	return lines.join("\n");
}
