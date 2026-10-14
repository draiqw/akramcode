import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { AgentToolResult } from "@akramcode/agent-core";
import type { Component, TUI } from "@akramcode/tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { ToolRenderContext } from "../src/core/extensions/types.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { type AgentToolDetails, createAgentToolDefinition } from "../src/core/subagents/agent-tool.ts";
import type { TaskNotificationDetails } from "../src/core/tasks/notifications.ts";
import { emptyTaskUsage, type TaskInfo } from "../src/core/tasks/task-registry.ts";
import { ToolPickerComponent } from "../src/extensions/tasks/agents.ts";
import { formatNotificationLine, formatTaskDetail, formatTaskListItem } from "../src/extensions/tasks/index.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

function plain(component: Component, width = 120): string {
	return stripVTControlCharacters(component.render(width).join("\n"))
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
}

function details(overrides: Partial<AgentToolDetails> = {}): AgentToolDetails {
	return {
		agentType: "explore",
		description: "Find the parser",
		status: "completed",
		toolUses: 5,
		usage: { ...emptyTaskUsage(), totalTokens: 12_345, toolUses: 5 },
		durationMs: 65_000,
		activity: ["read a.ts", "grep /parse/ in src", "ls src", "$ git log -1", "read src/parser.ts"],
		...overrides,
	};
}

describe("agent tool rendering", () => {
	beforeAll(() => initTheme("dark"));

	const tool = createAgentToolDefinition({
		cwd: "/repo",
		agentDir: join(tmpdir(), "akramcode-no-agents"),
		settingsManager: SettingsManager.inMemory(),
		modelRuntime: {} as ModelRuntime,
		sandbox: undefined,
		tasks: undefined,
		getModel: () => undefined,
		getThinkingLevel: () => "off",
		getContextFiles: () => [],
		getAgentTypes: () => ({ types: [], diagnostics: [] }),
		getToolSources: () => [],
		getTranscriptDir: () => tmpdir(),
		createSession: async () => {
			throw new Error("not used");
		},
	});

	function render(
		result: AgentToolResult<AgentToolDetails | undefined>,
		options: { expanded: boolean; isPartial: boolean },
	) {
		const context = {
			args: { description: "Find the parser", prompt: "find it" },
			toolCallId: "call",
			invalidate: () => {},
			lastComponent: undefined,
			state: {},
			cwd: "/repo",
			executionStarted: true,
			argsComplete: true,
			isPartial: options.isPartial,
			expanded: options.expanded,
			showImages: false,
			isError: false,
		} satisfies ToolRenderContext;
		return plain(tool.renderResult?.(result, options, theme, context) as Component);
	}

	it("renders the call header with description and type", () => {
		const context = {
			args: { description: "Find the parser", prompt: "x", subagent_type: "explore", run_in_background: true },
			toolCallId: "call",
			invalidate: () => {},
			lastComponent: undefined,
			state: {},
			cwd: "/repo",
			executionStarted: true,
			argsComplete: true,
			isPartial: true,
			expanded: false,
			showImages: false,
			isError: false,
		} satisfies ToolRenderContext;
		const component = tool.renderCall?.(context.args, theme, context) as Component;
		expect(plain(component)).toBe("agent(Find the parser) explore · background");
	});

	it("shows the last tool calls while running", () => {
		const text = render(
			{ content: [{ type: "text", text: "(running...)" }], details: details({ status: "running" }) },
			{ expanded: false, isPartial: true },
		);
		expect(text).toContain("+2 more tool uses");
		expect(text).toContain("⎿ ls src");
		expect(text).toContain("⎿ read src/parser.ts");
		expect(text).not.toContain("read a.ts");
		expect(text).toContain("Running… (5 tool uses · 12k tokens · 1m 05s)");
	});

	it("collapses the result to a stats line and expands to the final text", () => {
		const result = {
			content: [{ type: "text" as const, text: "The parser is in src/parser.ts." }],
			details: details(),
		};
		const collapsed = render(result, { expanded: false, isPartial: false });
		expect(collapsed).toContain("Done (5 tool uses · 12k tokens · 1m 05s)");
		expect(collapsed).not.toContain("src/parser.ts.");
		const expanded = render(result, { expanded: true, isPartial: false });
		expect(expanded).toContain("Done (5 tool uses · 12k tokens · 1m 05s)");
		expect(expanded).toContain("The parser is in src/parser.ts.");
	});

	it("shows the task of background agents", () => {
		const text = render(
			{
				content: [{ type: "text", text: "Agent running in background" }],
				details: details({ status: "running", background: { taskId: "a1", outputFile: "/tmp/a1.output" } }),
			},
			{ expanded: false, isPartial: false },
		);
		expect(text).toBe("Running in background (task a1) · /tmp/a1.output");
	});
});

describe("task monitoring formatting", () => {
	beforeAll(() => initTheme("dark"));

	const base: TaskInfo = {
		id: "b1",
		kind: "bash",
		description: "npm test",
		status: "completed",
		startedAt: 1_000,
		endedAt: 13_000,
		outputFile: "/tmp/b1.output",
		command: "npm test",
		exitCode: 0,
	};

	it("formats task notifications as one line", () => {
		const finished: TaskNotificationDetails = { task: base, event: "finished" };
		expect(stripVTControlCharacters(formatNotificationLine(finished, theme))).toBe(
			"● task b1 (bash: npm test) completed · exit 0 · 12s",
		);
		const output: TaskNotificationDetails = {
			task: { ...base, id: "m1", kind: "monitor", status: "running", description: "errors" },
			event: "output",
			lines: ["a", "b"],
			omittedLines: 1,
		};
		expect(stripVTControlCharacters(formatNotificationLine(output, theme))).toBe(
			"● task m1 (monitor: errors) · 3 new lines",
		);
	});

	it("formats the /tasks list and detail view", () => {
		const dir = mkdtempSync(join(tmpdir(), "akramcode-task-detail-"));
		try {
			const outputFile = join(dir, "a1.output");
			writeFileSync(outputFile, "- read a.ts\n- ls src\n");
			const agent: TaskInfo = {
				id: "a1",
				kind: "agent",
				description: "Research parser",
				status: "running",
				startedAt: 0,
				outputFile,
				agentType: "explore",
				usage: { ...emptyTaskUsage(), totalTokens: 2_500, toolUses: 2, turns: 3 },
			};
			expect(formatTaskListItem(agent, 30_000)).toBe("a1  running  agent: Research parser · 30s · 2.5k tokens");
			expect(formatTaskListItem(base)).toBe("b1  completed  bash: npm test · 12s · exit 0");
			const detail = formatTaskDetail(agent, 30_000);
			expect(detail).toContain("agent task a1: Research parser");
			expect(detail).toContain("Usage: 2 tool uses · 2.5k tokens · 3 turns");
			expect(detail).toContain("- read a.ts\n- ls src");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("tool picker", () => {
	beforeAll(() => initTheme("dark"));

	it("toggles tools with confirm and finishes on Done", () => {
		const keybindings = new KeybindingsManager();
		let result: string[] | undefined | "pending" = "pending";
		const picker = new ToolPickerComponent(
			[
				{ name: "read", description: "Read files" },
				{ name: "bash", description: "Run commands" },
				{ name: "mcp__gh__issues", description: "Issues" },
			],
			[],
			{ requestRender: () => {} } as unknown as TUI,
			theme,
			keybindings,
			(value) => {
				result = value;
			},
		);
		const down = "\x1b[B";
		const enter = "\r";
		picker.handleInput(enter); // read
		picker.handleInput(down);
		picker.handleInput(down);
		picker.handleInput(enter); // mcp__gh__issues
		expect(plain(picker)).toContain("[x] mcp__gh__issues");
		expect(plain(picker)).toContain("[ ] bash");
		picker.handleInput(down);
		expect(plain(picker)).toContain("→ Done (2 selected)");
		picker.handleInput(enter);
		expect(result).toEqual(["read", "mcp__gh__issues"]);
	});

	it("resolves undefined when cancelled", () => {
		let result: string[] | undefined | "pending" = "pending";
		const picker = new ToolPickerComponent(
			[{ name: "read", description: "" }],
			[],
			{ requestRender: () => {} } as unknown as TUI,
			theme,
			new KeybindingsManager(),
			(value) => {
				result = value;
			},
		);
		picker.handleInput("\x1b");
		expect(result).toBeUndefined();
	});
});
