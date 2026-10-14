import type { AssistantMessage, AssistantMessageEvent } from "@akramcode/ai";
import { describe, expect, it } from "vitest";
import { formatElapsed, formatRunStats, RunStatsTracker } from "../src/modes/interactive/run-stats.ts";

function delta(type: "text_delta" | "thinking_delta" | "toolcall_delta", text: string): AssistantMessageEvent {
	return { type, contentIndex: 0, delta: text, partial: {} as AssistantMessage } as AssistantMessageEvent;
}

function finished(output: number): AssistantMessage {
	return {
		usage: { input: 0, output, cacheRead: 0, cacheWrite: 0, totalTokens: output, cost: { total: 0 } },
	} as unknown as AssistantMessage;
}

describe("RunStatsTracker", () => {
	it("estimates streaming tokens from deltas and measures speed from the first delta", () => {
		const tracker = new RunStatsTracker();
		tracker.startRun(0);
		// Time to first token (2s) does not count against speed.
		tracker.onUpdate(delta("thinking_delta", "a".repeat(40)), 2_000);
		tracker.onUpdate(delta("text_delta", "b".repeat(40)), 3_000);
		tracker.onUpdate(delta("toolcall_delta", "c".repeat(40)), 4_000);

		const stats = tracker.snapshot(4_500);
		expect(stats.elapsedMs).toBe(4_500);
		expect(stats.outputTokens).toBe(30);
		expect(stats.tokensPerSecond).toBe(15);
	});

	it("ignores non-delta events and reports no speed for very short windows", () => {
		const tracker = new RunStatsTracker();
		tracker.startRun(0);
		tracker.onUpdate({ type: "text_start", contentIndex: 0, partial: {} as AssistantMessage }, 100);
		tracker.onUpdate(delta("text_delta", "abcd"), 200);
		tracker.onUpdate(delta("text_delta", "abcd"), 300);
		expect(tracker.snapshot(300)).toEqual({ elapsedMs: 300, outputTokens: 2, tokensPerSecond: undefined });
	});

	it("prefers provider output counts at message end and keeps the last speed across responses", () => {
		const tracker = new RunStatsTracker();
		tracker.startRun(0);
		tracker.onUpdate(delta("text_delta", "x".repeat(400)), 1_000);
		tracker.onUpdate(delta("text_delta", "x".repeat(400)), 3_000);
		tracker.onMessageEnd(finished(100));
		expect(tracker.lastSpeed).toBe(50);

		// A tool runs; no new deltas yet, so the last speed is still shown.
		expect(tracker.snapshot(10_000)).toEqual({ elapsedMs: 10_000, outputTokens: 100, tokensPerSecond: 50 });

		tracker.onUpdate(delta("text_delta", "y".repeat(80)), 11_000);
		expect(tracker.snapshot(11_000).outputTokens).toBe(120);

		tracker.endRun();
		expect(tracker.isRunning).toBe(false);
		expect(tracker.lastSpeed).toBe(50);
	});

	it("falls back to the estimate when the provider reports no output tokens", () => {
		const tracker = new RunStatsTracker();
		tracker.startRun(0);
		tracker.onUpdate(delta("text_delta", "x".repeat(200)), 0);
		tracker.onUpdate(delta("text_delta", "x".repeat(200)), 1_000);
		tracker.onMessageEnd(finished(0));
		expect(tracker.snapshot(2_000).outputTokens).toBe(100);
		expect(tracker.lastSpeed).toBe(100);
	});
});

describe("run stats formatting", () => {
	it("formats elapsed time", () => {
		expect(formatElapsed(999)).toBe("0s");
		expect(formatElapsed(45_000)).toBe("45s");
		expect(formatElapsed(185_000)).toBe("3m 05s");
		expect(formatElapsed(3_720_000)).toBe("1h 02m");
	});

	it("adds the token part once output arrives", () => {
		expect(formatRunStats({ elapsedMs: 12_000, outputTokens: 0, tokensPerSecond: undefined })).toBe("12s");
		expect(formatRunStats({ elapsedMs: 65_000, outputTokens: 1_234, tokensPerSecond: 48.04 })).toBe(
			"1m 05s · ↓ 1.2k tokens",
		);
		expect(formatRunStats({ elapsedMs: 5_000, outputTokens: 900, tokensPerSecond: 180.6 })).toBe("5s · ↓ 900 tokens");
	});
});
