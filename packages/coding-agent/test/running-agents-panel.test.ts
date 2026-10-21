import { setKeybindings } from "@akramcode/tui";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { emptySubagentUsage, type SubagentInfo } from "../src/core/subagents/subagent-registry.ts";
import { RunningAgentsPanel } from "../src/modes/interactive/components/running-agents-panel.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const DOWN = "\x1b[B";
const UP = "\x1b[A";
const ENTER = "\r";
const ESCAPE = "\x1b";

function agent(overrides: Partial<SubagentInfo> = {}): SubagentInfo {
	const now = Date.now();
	return {
		id: "a1",
		agentType: "explore",
		description: "find config files",
		status: "running",
		foreground: true,
		source: "agent",
		prompt: "find",
		startedAt: now,
		runStartedAt: now,
		activeMs: 0,
		usage: emptySubagentUsage(),
		activity: [],
		...overrides,
	};
}

function lines(panel: RunningAgentsPanel, width = 200): string[] {
	return panel.render(width).map((line) => stripAnsi(line));
}

function panelWithActions() {
	const actions = { open: vi.fn(), openMain: vi.fn(), stop: vi.fn(), exit: vi.fn() };
	const panel = new RunningAgentsPanel(() => {});
	panel.setActions(actions);
	return { panel, actions };
}

describe("RunningAgentsPanel", () => {
	beforeAll(() => {
		initTheme("dark");
		setKeybindings(new KeybindingsManager());
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

	test("formats an agent with its type, description, time, and tokens", () => {
		const panel = new RunningAgentsPanel(() => {});
		panel.set(agent({ usage: { ...emptySubagentUsage(), totalTokens: 12_345 }, activity: ["read ~/src/x.ts"] }));
		vi.advanceTimersByTime(72_000);
		expect(lines(panel)).toEqual(["  ● explore: find config files · 1m 12s · 12k tokens", "  down to switch chat"]);
		panel.dispose();
	});

	test("truncates lines to the width", () => {
		const panel = new RunningAgentsPanel(() => {});
		panel.set(agent({ description: "a very long description of the work this agent is doing" }));
		const [line] = lines(panel, 30);
		expect(line).toHaveLength(30);
		expect(line?.endsWith("…")).toBe(true);
		panel.dispose();
	});

	test("re-renders once a second only while an agent runs", () => {
		const requestRender = vi.fn();
		const panel = new RunningAgentsPanel(requestRender);
		panel.set(agent());
		requestRender.mockClear();
		vi.advanceTimersByTime(3000);
		expect(requestRender).toHaveBeenCalledTimes(3);

		panel.set(agent({ status: "completed", endedAt: Date.now(), activeMs: 3000 }));
		requestRender.mockClear();
		vi.advanceTimersByTime(3000);
		expect(requestRender).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	test("removes finished agents, except the one whose chat is open until it is left", () => {
		const panel = new RunningAgentsPanel(() => {});
		panel.set(agent({ id: "a1", description: "works" }));
		panel.set(agent({ id: "a2", description: "open" }));
		panel.set(agent({ id: "a1", description: "works", status: "completed", activeMs: 5000 }));
		expect(lines(panel)).toEqual(["  ● explore: open · 0s", "  down to switch chat"]);

		// In an agent's chat the bar above the editor carries the hint.
		panel.setViewing("a2");
		panel.set(agent({ id: "a2", description: "open", status: "failed", activeMs: 1000 }));
		expect(lines(panel)).toEqual(["  ✗ explore: open · 1s · open"]);
		panel.setViewing(undefined);
		expect(lines(panel)).toEqual([]);
	});

	test("caps the list and lists running agents before finished ones", () => {
		const panel = new RunningAgentsPanel(() => {});
		// A finished agent is listed only while its chat is open.
		panel.setViewing("done");
		panel.set(agent({ id: "done", description: "done", status: "completed" }));
		for (let i = 1; i <= 6; i++) panel.set(agent({ id: `r${i}`, description: `task ${i}` }));
		expect(lines(panel)).toEqual([
			"  ● explore: task 1 · 0s",
			"  ● explore: task 2 · 0s",
			"  ● explore: task 3 · 0s",
			"  ● explore: task 4 · 0s",
			"  +3 more",
		]);
		panel.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});

	test("selects agents and the main chat with the keyboard, opens, stops, and exits", () => {
		const { panel, actions } = panelWithActions();
		panel.set(agent({ id: "a1", description: "first" }));
		panel.set(agent({ id: "a2", description: "second" }));
		// From the main chat, selection starts on the first agent.
		expect(panel.select()).toBe(true);
		panel.focused = true;
		expect(lines(panel)).toEqual([
			"  main chat · open",
			"› ● explore: first · 0s",
			"  ● explore: second · 0s",
			"  enter to open · x to stop · escape to cancel",
		]);

		panel.handleInput("x");
		expect(actions.stop).toHaveBeenCalledWith("a1");
		panel.handleInput(DOWN);
		panel.handleInput(ENTER);
		expect(actions.open).toHaveBeenCalledWith("a2");

		// From an agent's chat, selection starts on the main chat.
		panel.setViewing("a2");
		panel.set(agent({ id: "a2", description: "second", status: "completed" }));
		panel.select();
		panel.handleInput(DOWN);
		panel.handleInput(DOWN);
		panel.handleInput("x");
		// A finished agent cannot be stopped.
		expect(actions.stop).toHaveBeenCalledTimes(1);
		panel.select();
		expect(lines(panel)[0]).toBe("› main chat");
		expect(lines(panel)[2]).toBe("  ✓ explore: second · 0s · open");
		panel.handleInput(ENTER);
		expect(actions.openMain).toHaveBeenCalledTimes(1);
		panel.handleInput(UP);
		expect(actions.exit).toHaveBeenCalledTimes(1);
		panel.handleInput(ESCAPE);
		expect(actions.exit).toHaveBeenCalledTimes(2);
		panel.dispose();
	});

	test("opens an agent on click", () => {
		const { panel, actions } = panelWithActions();
		panel.set(agent({ id: "a1", description: "first" }));
		panel.set(agent({ id: "a2", description: "second" }));
		panel.render(80);
		panel.handleMouse({ type: "click", button: "left", x: 5, y: 1, width: 80 } as Parameters<
			RunningAgentsPanel["handleMouse"]
		>[0]);
		expect(actions.open).toHaveBeenCalledWith("a2");
		panel.dispose();
	});

	test("has nothing to select when empty", () => {
		const { panel } = panelWithActions();
		expect(panel.select()).toBe(false);
	});
});
