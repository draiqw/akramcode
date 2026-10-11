import { beforeAll, describe, expect, test } from "vitest";
import { localDayKey, renderUsageHeatmap } from "../src/modes/interactive/components/usage-heatmap.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("renderUsageHeatmap", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("draws weeks as columns with weekday rows, months, and a legend", () => {
		// Sunday, 11 October 2026.
		const now = new Date(2026, 9, 11, 12).getTime();
		const tokens = new Map([
			[localDayKey(now), 1000],
			[localDayKey(new Date(2026, 9, 5).getTime()), 10],
		]);
		const lines = renderUsageHeatmap(tokens, 4 + 2 * 3, now).map(stripAnsi);

		expect(lines).toEqual([
			"    Sep",
			"Mon · · ░",
			"    · · ·",
			"Wed · · ·",
			"    · · ·",
			"Fri · · ·",
			"    · · ·",
			"Sun · · █",
			"    Less · ░ ▒ ▓ █ More",
		]);
	});

	test("stops at today", () => {
		// Wednesday: Thursday to Sunday of this week are not drawn.
		const now = new Date(2026, 9, 7, 12).getTime();
		const lines = renderUsageHeatmap(new Map(), 4 + 2, now).map(stripAnsi);
		expect(lines.slice(1, 8)).toEqual(["Mon ·", "    ·", "Wed ·", "", "Fri", "", "Sun"]);
	});
});
