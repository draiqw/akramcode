import {
	type Component,
	type Focusable,
	getKeybindings,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
} from "@akramcode/tui";
import { formatSubagentStats } from "../../../core/subagents/agent-tool.ts";
import {
	type SubagentInfo,
	type SubagentRegistry,
	type SubagentStatus,
	subagentElapsedMs,
} from "../../../core/subagents/subagent-registry.ts";
import { theme } from "../theme/theme.ts";
import { keyText } from "./keybinding-hints.ts";

/** Agents the panel lists; more are counted in a "+N more" line. */
const MAX_VISIBLE_AGENTS = 5;
const TICK_MS = 1000;

function statusMark(status: SubagentStatus): string {
	switch (status) {
		case "running":
			return theme.fg("accent", "●");
		case "completed":
			return theme.fg("success", "✓");
		case "failed":
			return theme.fg("error", "✗");
		case "stopped":
			return theme.fg("warning", "✗");
	}
}

/** One panel line, for example "● explore: find config files · 1m 12s · 12k tokens". */
export function formatRunningAgentLine(agent: SubagentInfo, now: number): string {
	const title = `${agent.agentType}: ${agent.description.replace(/\s+/g, " ").trim()}`;
	const stats = formatSubagentStats(subagentElapsedMs(agent, now), agent.usage.totalTokens);
	return `${statusMark(agent.status)} ${theme.fg("text", title)}${theme.fg("dim", ` · ${stats}`)}`;
}

export interface RunningAgentsPanelActions {
	/** Open the agent's chat. */
	open(id: string): void;
	/** Show the main chat. */
	openMain(): void;
	/** Stop a running agent. */
	stop(id: string): void;
	/** Give focus back to the editor. */
	exit(): void;
}

/** Row id of the main chat, listed above the agents while the panel is focused. */
const MAIN_ROW = "main";

/**
 * Running subagents below the editor, one line each; a finished one stays only while its chat is
 * open. `app.agents.focus` selects a line; while selecting, a "main chat" line leads the list, so
 * switching to an agent and back works the same way. A click opens a line too. The panel renders
 * nothing when empty and re-renders once a second only while an agent runs.
 */
export class RunningAgentsPanel implements Component, Focusable {
	focused = false;
	private readonly agents = new Map<string, SubagentInfo>();
	private readonly requestRender: () => void;
	private actions: RunningAgentsPanelActions | undefined;
	private selectedId: string | undefined;
	private viewingId: string | undefined;
	private tickTimer: NodeJS.Timeout | undefined;
	/** Ids of the rows the last render showed, top to bottom, for mouse clicks. */
	private rowIds: Array<string | undefined> = [];

	constructor(requestRender: () => void) {
		this.requestRender = requestRender;
	}

	setActions(actions: RunningAgentsPanelActions): void {
		this.actions = actions;
	}

	/** Add or update an agent; a finished one is removed unless its chat is open. */
	set(info: SubagentInfo): void {
		if (info.status === "running" || info.id === this.viewingId) this.agents.set(info.id, info);
		else this.agents.delete(info.id);
		this.changed();
	}

	get(id: string): SubagentInfo | undefined {
		return this.agents.get(id);
	}

	clear(): void {
		this.agents.clear();
		this.selectedId = undefined;
		this.viewingId = undefined;
		this.changed();
	}

	/** Mark the agent whose chat is open; undefined for the main chat. Leaving a finished agent's chat removes it. */
	setViewing(id: string | undefined): void {
		const left = this.viewingId !== undefined && this.viewingId !== id ? this.agents.get(this.viewingId) : undefined;
		this.viewingId = id;
		if (left && left.status !== "running") this.agents.delete(left.id);
		this.changed();
	}

	/**
	 * Start keyboard selection on the line after the open chat: the first agent from the main chat,
	 * the main chat from an agent's chat. Returns false when there is no agent.
	 */
	select(): boolean {
		const ordered = this.ordered();
		if (ordered.length === 0) return false;
		this.selectedId = this.viewingId ? MAIN_ROW : ordered[0].id;
		this.requestRender();
		return true;
	}

	dispose(): void {
		this.clear();
	}

	invalidate(): void {}

	handleInput(data: string): void {
		const keybindings = getKeybindings();
		const rows = [MAIN_ROW, ...this.ordered().map((agent) => agent.id)];
		const index = rows.indexOf(this.selectedId ?? "");
		if (keybindings.matches(data, "tui.select.up")) {
			if (index <= 0) this.actions?.exit();
			else this.selectedId = rows[index - 1];
		} else if (keybindings.matches(data, "tui.select.down")) {
			if (index < rows.length - 1) this.selectedId = rows[index + 1];
		} else if (keybindings.matches(data, "tui.select.confirm")) {
			if (this.selectedId) this.openRow(this.selectedId);
		} else if (keybindings.matches(data, "app.agents.stop")) {
			if (this.selectedId && this.agents.get(this.selectedId)?.status === "running") {
				this.actions?.stop(this.selectedId);
			}
		} else if (keybindings.matches(data, "tui.select.cancel") || keybindings.matches(data, "app.interrupt")) {
			this.actions?.exit();
		} else {
			return;
		}
		this.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const id = this.rowIds[event.y];
		if (!id) return undefined;
		if (event.type === "click" && event.button === "left") {
			this.selectedId = id;
			this.openRow(id);
			return { handled: true };
		}
		return undefined;
	}

	render(width: number): string[] {
		const ordered = this.ordered();
		if (ordered.length === 0) {
			this.rowIds = [];
			return [];
		}
		const now = Date.now();
		const contentWidth = Math.max(1, width - 2);
		const open = theme.fg("dim", " · open");
		const row = (id: string, text: string, current: boolean) => {
			const selected = this.focused && id === this.selectedId;
			const prefix = selected ? theme.fg("accent", "›") : " ";
			const body = truncateToWidth(`${text}${current ? open : ""}`, contentWidth, "…");
			return `${prefix} ${selected ? theme.bold(body) : body}`;
		};
		const lines: string[] = [];
		this.rowIds = [];
		if (this.focused) {
			lines.push(row(MAIN_ROW, theme.fg("text", "main chat"), this.viewingId === undefined));
			this.rowIds.push(MAIN_ROW);
		}
		const selectedIndex = this.focused ? ordered.findIndex((agent) => agent.id === this.selectedId) : -1;
		// Keep the selection in view: the window starts so that the selected agent is its last row at most.
		const capacity = ordered.length > MAX_VISIBLE_AGENTS ? MAX_VISIBLE_AGENTS - 1 : ordered.length;
		const start = Math.max(0, Math.min(selectedIndex - capacity + 1, ordered.length - capacity));
		for (const agent of ordered.slice(start, start + capacity)) {
			lines.push(row(agent.id, formatRunningAgentLine(agent, now), agent.id === this.viewingId));
			this.rowIds.push(agent.id);
		}
		const hidden = ordered.length - capacity;
		if (hidden > 0) {
			lines.push(`  ${theme.fg("dim", `+${hidden} more`)}`);
			this.rowIds.push(undefined);
		}
		const hint = this.focused
			? [
					`${keyText("tui.select.confirm")} to open`,
					`${keyText("app.agents.stop")} to stop`,
					`${keyText("app.interrupt")} to cancel`,
				].join(" · ")
			: `${keyText("app.agents.focus")} to switch chat`;
		// In an agent's chat the bar above the editor carries the hint.
		if (this.focused || this.viewingId === undefined) {
			lines.push(`  ${theme.fg("dim", truncateToWidth(hint, contentWidth))}`);
			this.rowIds.push(undefined);
		}
		return lines;
	}

	private openRow(id: string): void {
		if (id === MAIN_ROW) this.actions?.openMain();
		else this.actions?.open(id);
	}

	/** Running agents first, so finished ones never push them below the cap; oldest first within each. */
	private ordered(): SubagentInfo[] {
		const all = [...this.agents.values()];
		return [...all.filter((a) => a.status === "running"), ...all.filter((a) => a.status !== "running")];
	}

	private changed(): void {
		if (this.selectedId && this.selectedId !== MAIN_ROW && !this.agents.has(this.selectedId)) {
			this.selectedId = MAIN_ROW;
		}
		// Nothing left to select: give the keyboard back.
		if (this.focused && this.agents.size === 0) this.actions?.exit();
		const running = [...this.agents.values()].some((agent) => agent.status === "running");
		if (running && !this.tickTimer) {
			this.tickTimer = setInterval(() => this.requestRender(), TICK_MS);
			this.tickTimer.unref?.();
		} else if (!running && this.tickTimer) {
			clearInterval(this.tickTimer);
			this.tickTimer = undefined;
		}
		this.requestRender();
	}
}

/** Keep `panel` in sync with the session's subagents. Returns the unsubscribe function. */
export function trackRunningAgents(subagents: SubagentRegistry, panel: RunningAgentsPanel): () => void {
	panel.clear();
	for (const agent of subagents.list()) {
		if (agent.status === "running") panel.set(agent);
	}
	const unsubscribe = subagents.subscribe((event) => panel.set(event.agent));
	return () => {
		unsubscribe();
		panel.clear();
	};
}
