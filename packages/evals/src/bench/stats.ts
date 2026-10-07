/**
 * Statistics for A/B benchmark reports. Pure functions, no I/O.
 *
 * Pass rates use the Wilson score interval (well behaved for small n and rates near 0 or 1).
 * Paired quality differences use the exact McNemar test on (task, repetition) pairs and a
 * task-clustered bootstrap for the confidence interval: repetitions of one task are correlated,
 * so resampling whole tasks avoids overstating precision.
 */

export interface Interval {
	low: number;
	high: number;
}

const Z_95 = 1.959963984540054;

/** Wilson score interval for k successes out of n trials. Returns [0, 1] when n is 0. */
export function wilsonInterval(successes: number, trials: number, z = Z_95): Interval {
	if (!Number.isInteger(successes) || !Number.isInteger(trials) || successes < 0 || trials < 0) {
		throw new RangeError("Wilson interval needs non-negative integer counts.");
	}
	if (successes > trials) throw new RangeError("Successes cannot exceed trials.");
	if (trials === 0) return { low: 0, high: 1 };
	const p = successes / trials;
	const z2 = z * z;
	const denominator = 1 + z2 / trials;
	const center = (p + z2 / (2 * trials)) / denominator;
	const margin = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
	return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export function sum(values: readonly number[]): number {
	let total = 0;
	for (const value of values) total += value;
	return total;
}

export function mean(values: readonly number[]): number | undefined {
	return values.length === 0 ? undefined : sum(values) / values.length;
}

/** Linear-interpolated quantile (same as numpy's default). */
export function quantile(values: readonly number[], q: number): number | undefined {
	if (values.length === 0) return undefined;
	if (q < 0 || q > 1) throw new RangeError("Quantile must be in [0, 1].");
	const sorted = [...values].sort((a, b) => a - b);
	const position = (sorted.length - 1) * q;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function median(values: readonly number[]): number | undefined {
	return quantile(values, 0.5);
}

function logChoose(n: number, k: number): number {
	let result = 0;
	for (let i = 1; i <= k; i++) result += Math.log(n - k + i) - Math.log(i);
	return result;
}

/** Two-sided exact binomial test of k successes in n trials against p = 0.5. */
export function binomialTwoSidedP(k: number, n: number): number {
	if (n === 0) return 1;
	const tail = Math.min(k, n - k);
	let probability = 0;
	for (let i = 0; i <= tail; i++) probability += Math.exp(logChoose(n, i) - n * Math.LN2);
	return Math.min(1, 2 * probability);
}

export interface McNemarResult {
	/** Pairs where the baseline passed and the candidate failed. */
	baselineOnly: number;
	/** Pairs where the candidate passed and the baseline failed. */
	candidateOnly: number;
	bothPass: number;
	bothFail: number;
	pValue: number;
}

/** Exact McNemar test on paired binary outcomes. */
export function mcnemarExact(pairs: readonly { baseline: boolean; candidate: boolean }[]): McNemarResult {
	let baselineOnly = 0;
	let candidateOnly = 0;
	let bothPass = 0;
	let bothFail = 0;
	for (const pair of pairs) {
		if (pair.baseline && pair.candidate) bothPass++;
		else if (pair.baseline) baselineOnly++;
		else if (pair.candidate) candidateOnly++;
		else bothFail++;
	}
	const pValue = binomialTwoSidedP(Math.min(baselineOnly, candidateOnly), baselineOnly + candidateOnly);
	return { baselineOnly, candidateOnly, bothPass, bothFail, pValue };
}

/**
 * Newcombe (1998, method 10) score interval for the difference of paired proportions,
 * candidate rate minus baseline rate. Conservative at small n where a bootstrap collapses to a
 * point (e.g. every pair concordant).
 */
export function newcombePairedInterval(result: McNemarResult, z = Z_95): Interval | undefined {
	const a = result.bothPass;
	const b = result.baselineOnly;
	const c = result.candidateOnly;
	const d = result.bothFail;
	const n = a + b + c + d;
	if (n === 0) return undefined;
	const p1 = (a + c) / n;
	const p2 = (a + b) / n;
	const w1 = wilsonInterval(a + c, n, z);
	const w2 = wilsonInterval(a + b, n, z);
	const product = (a + b) * (c + d) * (a + c) * (b + d);
	const phi = product > 0 ? (a * d - b * c) / Math.sqrt(product) : 0;
	const delta = Math.sqrt(
		Math.max(0, (p1 - w1.low) ** 2 - 2 * phi * (p1 - w1.low) * (w2.high - p2) + (w2.high - p2) ** 2),
	);
	const epsilon = Math.sqrt(
		Math.max(0, (w1.high - p1) ** 2 - 2 * phi * (w1.high - p1) * (p2 - w2.low) + (p2 - w2.low) ** 2),
	);
	const theta = p1 - p2;
	return { low: Math.max(-1, theta - delta), high: Math.min(1, theta + epsilon) };
}

/** Deterministic PRNG (mulberry32) so bootstrap intervals are reproducible. */
export function createRng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Percentile bootstrap over clusters. `statistic` receives a resample of clusters (with replacement)
 * and returns a number, or undefined when the resample is degenerate (those draws are skipped).
 */
export function clusterBootstrap<T>(
	clusters: readonly T[],
	statistic: (sample: readonly T[]) => number | undefined,
	options: { iterations?: number; seed?: number; confidence?: number } = {},
): Interval | undefined {
	if (clusters.length === 0) return undefined;
	const iterations = options.iterations ?? 5000;
	const rng = createRng(options.seed ?? 1);
	const alpha = 1 - (options.confidence ?? 0.95);
	const estimates: number[] = [];
	const sample: T[] = new Array(clusters.length);
	for (let i = 0; i < iterations; i++) {
		for (let j = 0; j < clusters.length; j++) sample[j] = clusters[Math.floor(rng() * clusters.length)];
		const value = statistic(sample);
		if (value !== undefined && Number.isFinite(value)) estimates.push(value);
	}
	if (estimates.length === 0) return undefined;
	return { low: quantile(estimates, alpha / 2)!, high: quantile(estimates, 1 - alpha / 2)! };
}

/** Relative change b/a - 1, or undefined when a is zero. */
export function relativeChange(baseline: number, candidate: number): number | undefined {
	return baseline === 0 ? undefined : candidate / baseline - 1;
}
