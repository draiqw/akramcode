import { describe, expect, test } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type Detail = (this: unknown) => string | undefined;
const getWorkingStatsDetail = (InteractiveMode.prototype as unknown as { getWorkingStatsDetail: Detail })
	.getWorkingStatsDetail;

function fakeThis(running: number, elapsedMs: number | undefined) {
	return {
		runStats: {
			isRunning: elapsedMs !== undefined,
			snapshot: () => ({ elapsedMs: elapsedMs ?? 0, outputTokens: 550, outputTokensEstimated: false, speed: 55 }),
		},
		session: { tasks: { running: () => Array.from({ length: running }) } },
	};
}

describe("working indicator detail", () => {
	test("adds running background tasks after the run stats", () => {
		expect(getWorkingStatsDetail.call(fakeThis(2, 30_000))).toMatch(/^30s · .* · 2 tasks running$/);
		expect(getWorkingStatsDetail.call(fakeThis(1, 500))).toBe("1 task running");
		expect(getWorkingStatsDetail.call(fakeThis(0, 500))).toBeUndefined();
	});
});
