import type { AgentMessage } from "@akramcode/agent-core";
import { describe, expect, it } from "vitest";
import {
	CLEARED_TOOL_RESULT_PREFIX,
	DEFAULT_CLEAR_TOOL_RESULTS_SETTINGS,
	planToolResultClearing,
} from "../src/core/compaction/clear-tool-results.ts";
import type { SessionEntry, SessionProjection } from "../src/core/session-manager.ts";

function toolResult(id: string, toolName: string, chars: number, text?: string) {
	const message = {
		role: "toolResult",
		toolCallId: `call-${id}`,
		toolName,
		content: [{ type: "text", text: text ?? "x".repeat(chars) }],
		isError: false,
		timestamp: 0,
	} as AgentMessage;
	const sourceEntry = { type: "message", id, parentId: null, timestamp: "", message } as SessionEntry;
	return { sourceEntry, messages: [message] };
}

function projection(...entries: ReturnType<typeof toolResult>[]): SessionProjection {
	return { entries, messages: entries.flatMap((entry) => entry.messages), thinkingLevel: "off", model: null };
}

const settings = { ...DEFAULT_CLEAR_TOOL_RESULTS_SETTINGS, keep: 1, minResultTokens: 100 };

describe("planToolResultClearing", () => {
	it("clears old large results, keeps the most recent and the small ones", () => {
		const plan = planToolResultClearing(
			projection(toolResult("a", "bash", 8000), toolResult("b", "read", 200), toolResult("c", "bash", 8000)),
			6000,
			6000,
			settings,
		);
		expect(plan?.targets.map((target) => target.entryId)).toEqual(["a"]);
		expect(plan?.targets[0]?.placeholder.startsWith(CLEARED_TOOL_RESULT_PREFIX)).toBe(true);
		expect(plan?.tokensAfter).toBeLessThan(6000 * settings.targetRatio);
	});

	it("falls back to a summary when clearing does not free enough", () => {
		expect(
			planToolResultClearing(
				projection(toolResult("a", "bash", 800), toolResult("b", "bash", 800)),
				6000,
				6000,
				settings,
			),
		).toBeUndefined();
	});

	it("skips excluded tools, already cleared results, and does nothing when disabled", () => {
		const entries = projection(
			toolResult("a", "read", 8000),
			toolResult("b", "bash", 0, `${CLEARED_TOOL_RESULT_PREFIX}: bash output]`),
			toolResult("c", "bash", 8000),
		);
		expect(planToolResultClearing(entries, 4000, 4000, { ...settings, excludeTools: ["read"] })).toBeUndefined();
		expect(planToolResultClearing(entries, 4000, 4000, { ...settings, enabled: false })).toBeUndefined();
		expect(planToolResultClearing(entries, 4000, 4000, settings)?.targets.map((target) => target.entryId)).toEqual([
			"a",
		]);
	});
});
