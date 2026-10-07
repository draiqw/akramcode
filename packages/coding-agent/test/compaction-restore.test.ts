import type { AgentMessage } from "@akramcode/agent-core";
import { describe, expect, it } from "vitest";
import {
	collectRestoredContext,
	formatRestoredContext,
	RESTORED_CONTEXT_MARKER,
	stripRestoredContext,
} from "../src/core/compaction/restore.ts";

const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 0 });

function call(id: string, name: string, path: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: { path } }],
		api: "test",
		provider: "test",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 0,
	} as AgentMessage;
}

function result(id: string, name: string, text: string, isError = false): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName: name,
		content: [{ type: "text", text }],
		isError,
		timestamp: 0,
	} as AgentMessage;
}

describe("compaction restored context", () => {
	it("restores the summarized request verbatim when no user message is kept", () => {
		const restored = collectRestoredContext([user("step 1: do A\nstep 2: write b.txt")], undefined, false);
		expect(restored.activeRequest).toBe("step 1: do A\nstep 2: write b.txt");
	});

	it("does not restore the request when a later user message is kept", () => {
		expect(collectRestoredContext([user("old task")], undefined, true).activeRequest).toBeUndefined();
	});

	it("carries the request across repeated compactions of the same turn", () => {
		const restored = collectRestoredContext([call("1", "bash", "x")], { activeRequest: "original task" }, false);
		expect(restored.activeRequest).toBe("original task");
	});

	it("restores the latest content of read files, newest first, and drops files changed after reading", () => {
		const restored = collectRestoredContext(
			[
				call("1", "read", "a.ts"),
				result("1", "read", "A1"),
				call("2", "read", "b.ts"),
				result("2", "read", "B"),
				call("3", "edit", "b.ts"),
				result("3", "edit", "ok"),
				call("4", "read", "a.ts"),
				result("4", "read", "A2"),
				call("5", "read", "c.ts"),
				result("5", "read", "boom", true),
			],
			undefined,
			true,
		);
		expect(restored.restoredFiles).toEqual([{ path: "a.ts", content: "A2" }]);
	});

	it("keeps older restored files that were not touched again, within the limits", () => {
		const restored = collectRestoredContext(
			[call("1", "read", "new.ts"), result("1", "read", "N"), call("2", "write", "old2.ts")],
			{
				restoredFiles: [
					{ path: "old1.ts", content: "O1" },
					{ path: "old2.ts", content: "O2" },
					{ path: "old3.ts", content: "x".repeat(50) },
				],
			},
			true,
			{ requestChars: 100, maxFiles: 3, fileChars: 20, totalFileChars: 30 },
		);
		expect(restored.restoredFiles?.map((file) => file.path)).toEqual(["new.ts", "old1.ts"]);
	});

	it("formats nothing when there is nothing to restore, and strips the restored part for the next summary", () => {
		expect(formatRestoredContext({})).toBe("");
		const summary = `## Goal\nx${formatRestoredContext({ activeRequest: "do it", restoredFiles: [{ path: "a", content: "A" }] })}`;
		expect(summary).toContain(RESTORED_CONTEXT_MARKER);
		expect(summary).toContain("<active-request>\ndo it\n</active-request>");
		expect(summary).toContain('<file path="a">\nA\n</file>');
		expect(stripRestoredContext(summary)).toBe("## Goal\nx");
	});
});
