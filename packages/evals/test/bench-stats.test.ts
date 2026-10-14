import { describe, expect, it } from "vitest";
import {
	binomialTwoSidedP,
	clusterBootstrap,
	mcnemarExact,
	median,
	newcombePairedInterval,
	quantile,
	relativeChange,
	wilsonInterval,
} from "../src/bench/stats.ts";

describe("wilsonInterval", () => {
	it("matches reference values", () => {
		// Reference: statsmodels proportion_confint(8, 10, method="wilson") = (0.4902, 0.9433)
		const interval = wilsonInterval(8, 10);
		expect(interval.low).toBeCloseTo(0.4902, 4);
		expect(interval.high).toBeCloseTo(0.9433, 4);
	});

	it("stays inside [0, 1] at the extremes", () => {
		const none = wilsonInterval(0, 5);
		expect(none.low).toBe(0);
		expect(none.high).toBeCloseTo(0.4345, 4);
		const all = wilsonInterval(5, 5);
		expect(all.high).toBe(1);
		expect(all.low).toBeCloseTo(0.5655, 4);
		expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
	});

	it("rejects invalid counts", () => {
		expect(() => wilsonInterval(3, 2)).toThrow("exceed");
		expect(() => wilsonInterval(-1, 2)).toThrow("non-negative");
	});
});

describe("quantiles", () => {
	it("interpolates like numpy", () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([4, 1, 2, 3])).toBe(2.5);
		expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
		expect(median([])).toBeUndefined();
	});
});

describe("binomial and McNemar", () => {
	it("computes exact two-sided binomial p-values", () => {
		expect(binomialTwoSidedP(0, 0)).toBe(1);
		// 2 * P(X <= 1 | n=10) = 2 * 11/1024
		expect(binomialTwoSidedP(1, 10)).toBeCloseTo(22 / 1024, 10);
		expect(binomialTwoSidedP(5, 10)).toBe(1);
	});

	it("counts discordant pairs", () => {
		const result = mcnemarExact([
			{ baseline: true, candidate: true },
			{ baseline: true, candidate: false },
			{ baseline: false, candidate: true },
			{ baseline: false, candidate: true },
			{ baseline: false, candidate: false },
		]);
		expect(result).toMatchObject({ bothPass: 1, baselineOnly: 1, candidateOnly: 2, bothFail: 1 });
		expect(result.pValue).toBe(1);
	});

	it("is significant only for lopsided discordance", () => {
		const pairs = Array.from({ length: 8 }, () => ({ baseline: true, candidate: false }));
		expect(mcnemarExact(pairs).pValue).toBeCloseTo(2 / 256, 10);
	});
});

describe("clusterBootstrap", () => {
	it("is deterministic for a seed and brackets the estimate", () => {
		const clusters = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const mean = (sample: readonly number[]) => sample.reduce((a, b) => a + b, 0) / sample.length;
		const first = clusterBootstrap(clusters, mean, { seed: 3, iterations: 2000 });
		const second = clusterBootstrap(clusters, mean, { seed: 3, iterations: 2000 });
		expect(first).toEqual(second);
		expect(first!.low).toBeLessThan(5.5);
		expect(first!.high).toBeGreaterThan(5.5);
		expect(first!.low).toBeGreaterThan(3);
		expect(first!.high).toBeLessThan(8);
	});

	it("returns a point interval when every cluster is identical", () => {
		expect(clusterBootstrap([2, 2, 2], (sample) => sample[0])).toEqual({ low: 2, high: 2 });
		expect(clusterBootstrap([], () => 1)).toBeUndefined();
	});
});

describe("relativeChange", () => {
	it("handles zero baselines", () => {
		expect(relativeChange(200, 150)).toBeCloseTo(-0.25);
		expect(relativeChange(0, 5)).toBeUndefined();
	});
});

describe("newcombePairedInterval", () => {
	const counts = (bothPass: number, baselineOnly: number, candidateOnly: number, bothFail: number) => ({
		bothPass,
		baselineOnly,
		candidateOnly,
		bothFail,
		pValue: 1,
	});

	it("stays wide when a few pairs all agree", () => {
		const interval = newcombePairedInterval(counts(2, 0, 0, 0))!;
		expect(interval.low).toBeLessThan(-0.5);
		expect(interval.high).toBeCloseTo(-interval.low, 10);
	});

	it("contains the point estimate, narrows with n, and mirrors when arms swap", () => {
		const small = newcombePairedInterval(counts(10, 3, 1, 6))!;
		const large = newcombePairedInterval(counts(100, 30, 10, 60))!;
		expect(small.low).toBeLessThan(-0.1);
		expect(small.high).toBeGreaterThan(-0.1);
		expect(large.high - large.low).toBeLessThan(small.high - small.low);
		const swapped = newcombePairedInterval(counts(10, 1, 3, 6))!;
		expect(swapped.low).toBeCloseTo(-small.high, 10);
		expect(swapped.high).toBeCloseTo(-small.low, 10);
		expect(newcombePairedInterval(counts(0, 0, 0, 0))).toBeUndefined();
	});
});
