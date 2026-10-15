import { describe, expect, test } from "vitest";
import { summarizeToolGroup, type ToolGroupItem } from "../src/modes/interactive/components/tool-group-summary.ts";

function done(toolName: string, args: unknown = {}): ToolGroupItem {
	return { toolName, args, status: "done" };
}

describe("summarizeToolGroup", () => {
	test("counts finished calls per tool in first-seen order with singular and plural wording", () => {
		const summary = summarizeToolGroup([
			done("read"),
			done("bash"),
			done("bash"),
			done("edit"),
			done("edit"),
			done("write"),
			done("ls"),
			done("ls"),
		]);

		expect(summary.done).toBe(
			"Read 1 file, ran 2 shell commands, edited 2 files, wrote 1 file, listed 2 directories",
		);
		expect(summary.active).toBeUndefined();
		expect(summary.failed).toBe(0);
	});

	test("merges grep and find into one search count", () => {
		expect(summarizeToolGroup([done("grep"), done("find"), done("grep")]).done).toBe("Searched 3 times");
	});

	test("uses a generic wording for extension and MCP tools", () => {
		expect(summarizeToolGroup([done("mcp_github_search"), done("mcp_github_search"), done("web_fetch")]).done).toBe(
			"Called mcp_github_search 2 times, called web_fetch",
		);
	});

	test("counts failed calls and keeps them in the totals", () => {
		const summary = summarizeToolGroup([done("bash"), { toolName: "bash", args: {}, status: "error" }]);

		expect(summary.done).toBe("Ran 2 shell commands");
		expect(summary.failed).toBe(1);
	});

	test("describes the first running call with its target", () => {
		const summary = summarizeToolGroup([
			done("read"),
			{ toolName: "bash", args: { command: "npm test\necho done" }, status: "running" },
			{ toolName: "read", args: { path: "b.ts" }, status: "running" },
		]);

		expect(summary.done).toBe("Read 1 file");
		expect(summary.active).toBe("Running npm test");
	});

	test("shortens long running targets and falls back to the verb without arguments", () => {
		const longPath = `src/${"a".repeat(100)}.ts`;
		const withPath = summarizeToolGroup([{ toolName: "read", args: { path: longPath }, status: "running" }]);
		expect(withPath.done).toBe("");
		expect(withPath.active?.startsWith("Reading src/")).toBe(true);
		expect(withPath.active?.endsWith("…")).toBe(true);
		expect(withPath.active?.length).toBeLessThan(80);

		expect(summarizeToolGroup([{ toolName: "custom", args: undefined, status: "running" }]).active).toBe(
			"Calling custom",
		);
	});
});
