import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { type RunningAgentInfo, RunningAgentsPanel } from "../src/modes/interactive/components/running-agents-panel.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function agent(overrides: Partial<RunningAgentInfo> = {}): RunningAgentInfo {
	return {
		agentType: "explore",
		description: "find config files",
		startedAt: Date.now(),
		status: "running",
		toolUses: 0,
		totalTokens: 0,
		...overrides,
	};
}

function lines(panel: RunningAgentsPanel, width = 200): string[] {
	return panel.render(width).map((line) => stripAnsi(line));
}

describe("RunningAgentsPanel", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("renders nothing when empty", () => {
		expect(new RunningAgentsPanel(() => {}).render(80)).toEqual([]);
	});

	test("formats a running agent with elapsed time, tool uses, activity, and tokens", () => {
		const panel = new RunningAgentsPanel(() => {});
		panel.set("a", agent({ toolUses: 3, totalTokens: 12_345, activity: "read ~/src/x.ts" }));
		vi.advanceTimersByTime(72_000);
		expect(lines(panel)).toEqual([
			" ● explore: find config files · 1m 12s · 3 tool uses · read ~/src/x.ts · 12k tokens",
		]);
		panel.dispose();
	});

	test("truncates lines to the width", () => {
		const panel = new RunningAgentsPanel(() => {});
		panel.set("a", agent({ activity: "read ~/a/very/long/path/to/some/file.ts" }));
		const [line] = lines(panel, 30);
		expect(line).toHaveLength(30);
		expect(line?.endsWith("…")).toBe(true);
		panel.dispose();
	});

	test("re-renders once a second only while an agent runs", () => {
		const requestRender = vi.fn();
		const panel = new RunningAgentsPanel(requestRender, 4000);
		panel.set("a", agent());
		requestRender.mockClear();
		vi.advanceTimersByTime(3000);
		expect(requestRender).toHaveBeenCalledTimes(3);

		panel.set("a", agent({ status: "completed", endedAt: Date.now() }));
		requestRender.mockClear();
		vi.advanceTimersByTime(3000);
		expect(requestRender).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(1);
	});

	test("shows a finished mark with the final elapsed time, then removes the agent", () => {
		const panel = new RunningAgentsPanel(() => {}, 4000);
		panel.set("ok", agent({ description: "works" }));
		panel.set("bad", agent({ description: "breaks" }));
		vi.advanceTimersByTime(5000);
		panel.set("ok", {
			...agent({ description: "works" }),
			startedAt: Date.now() - 5000,
			status: "completed",
			endedAt: Date.now(),
		});
		panel.set("bad", {
			...agent({ description: "breaks" }),
			startedAt: Date.now() - 5000,
			status: "failed",
			endedAt: Date.now(),
		});
		vi.advanceTimersByTime(2000);
		expect(lines(panel)).toEqual([" ✓ explore: works · 5s", " ✗ explore: breaks · 5s"]);

		vi.advanceTimersByTime(2000);
		expect(panel.render(80)).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
	});

	test("caps the list and lists running agents before finished ones", () => {
		const panel = new RunningAgentsPanel(() => {});
		panel.set("done", agent({ description: "done", status: "completed", endedAt: Date.now() }));
		for (let i = 1; i <= 6; i++) panel.set(`r${i}`, agent({ description: `task ${i}` }));
		expect(lines(panel)).toEqual([
			" ● explore: task 1 · 0s",
			" ● explore: task 2 · 0s",
			" ● explore: task 3 · 0s",
			" ● explore: task 4 · 0s",
			" +3 more",
		]);
		panel.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});

	test("finishRunning marks matching running agents", () => {
		const panel = new RunningAgentsPanel(() => {});
		panel.set("tool:1", agent({ description: "fg" }));
		panel.set("task:a1", agent({ description: "bg" }));
		panel.finishRunning("stopped", (id) => id.startsWith("tool:"));
		expect(lines(panel)).toEqual([" ● explore: bg · 0s", " ✗ explore: fg · 0s"]);
		panel.dispose();
	});
});
