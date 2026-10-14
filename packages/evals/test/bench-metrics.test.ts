import { describe, expect, it } from "vitest";
import { metricsFromJsonl } from "../src/bench/metrics.ts";

function usage(input: number, output: number, cacheRead: number, cost: number) {
	return { input, output, cacheRead, cacheWrite: 0, totalTokens: input + output + cacheRead, cost: { total: cost } };
}

const events = [
	{ type: "session", version: 3 },
	{ type: "agent_start" },
	{ type: "turn_start" },
	{ type: "message_start", message: { role: "assistant", content: [], usage: usage(0, 0, 0, 0) } },
	{ type: "message_update", usage: usage(5, 1, 0, 0) },
	{
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "toolCall", name: "read" }],
			usage: usage(1000, 50, 0, 0.01),
			stopReason: "toolUse",
		},
	},
	{ type: "tool_execution_start", toolName: "read" },
	{
		type: "tool_execution_end",
		toolName: "read",
		isError: false,
		result: { content: [{ type: "text", text: "abcd" }] },
	},
	{ type: "tool_execution_start", toolName: "bash" },
	{ type: "tool_execution_end", toolName: "bash", isError: true, result: { content: [{ type: "text", text: "no" }] } },
	{ type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "abcd" }] } },
	{ type: "turn_end" },
	{ type: "tool_results_cleared", count: 3, tokensBefore: 900, tokensAfter: 300 },
	{ type: "compaction_start", reason: "threshold" },
	{
		type: "compaction_end",
		reason: "threshold",
		aborted: false,
		willRetry: false,
		result: { usage: usage(400, 100, 0, 0.002) },
	},
	{ type: "compaction_end", reason: "threshold", aborted: true, willRetry: false, result: undefined },
	{ type: "compaction_end", reason: "overflow", aborted: false, willRetry: false, errorMessage: "summary failed" },
	{ type: "entry_appended", entry: { type: "compaction", usage: usage(200, 20, 0, 0.001) } },
	{ type: "entry_appended", entry: { type: "custom" } },
	{ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 10, errorMessage: "429" },
	{
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "All done." }],
			usage: usage(300, 10, 2000, 0.003),
			stopReason: "stop",
		},
	},
	{ type: "turn_end" },
	{ type: "agent_end", messages: [] },
];

describe("metricsFromJsonl", () => {
	const text = `${events.map((event) => JSON.stringify(event)).join("\n")}\nnot json\n`;
	const metrics = metricsFromJsonl(text);

	it("sums assistant and compaction usage", () => {
		expect(metrics.requests).toBe(2);
		expect(metrics.usage.input).toBe(1000 + 300 + 400 + 200);
		expect(metrics.usage.output).toBe(50 + 10 + 100 + 20);
		expect(metrics.usage.cacheRead).toBe(2000);
		expect(metrics.usage.total).toBe(1900 + 180 + 2000);
		expect(metrics.usage.cost).toBeCloseTo(0.016, 10);
		expect(metrics.compactionUsage.total).toBe(720);
		expect(metrics.peakContextTokens).toBe(2300);
	});

	it("counts turns, tools, and errors", () => {
		expect(metrics.turns).toBe(2);
		expect(metrics.toolCalls).toBe(2);
		expect(metrics.toolErrors).toBe(1);
		expect(metrics.toolCallsByName).toEqual({ read: 1, bash: 1 });
		expect(metrics.toolOutputChars).toBe(6);
		expect(metrics.autoRetries).toBe(1);
		expect(metrics.invalidLines).toBe(1);
		expect(metrics.sawAgentEnd).toBe(true);
		expect(metrics.finalStopReason).toBe("stop");
		expect(metrics.finalText).toBe("All done.");
	});

	it("counts threshold and online compactions and clears separately", () => {
		expect(metrics.compactions).toBe(2);
		expect(metrics.compactionFailures).toBe(1);
		expect(metrics.toolResultClears).toBe(1);
		expect(metrics.toolResultsCleared).toBe(3);
		expect(metrics.errorMessages).toEqual(["compaction: summary failed"]);
	});

	it("records request errors", () => {
		const failed = metricsFromJsonl(
			JSON.stringify({
				type: "message_end",
				message: {
					role: "assistant",
					content: [],
					usage: usage(1, 0, 0, 0),
					stopReason: "error",
					errorMessage: "boom",
				},
			}),
		);
		expect(failed.requestErrors).toBe(1);
		expect(failed.errorMessages).toEqual(["boom"]);
		expect(failed.sawAgentEnd).toBe(false);
	});
});
