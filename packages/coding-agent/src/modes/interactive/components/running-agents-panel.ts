import { type Component, truncateToWidth } from "@akramcode/tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import type { AgentToolDetails } from "../../../core/subagents/agent-tool.ts";
import { formatElapsed, formatTokenCount } from "../../../core/tasks/notifications.ts";
import type { TaskInfo, TaskStatus } from "../../../core/tasks/task-registry.ts";
import { theme } from "../theme/theme.ts";

/** Agents the panel lists; more are counted in a "+N more" line. */
const MAX_VISIBLE_AGENTS = 5;
/** How long a finished agent stays in the panel with its done or failed mark. */
const FINISHED_LINGER_MS = 4000;
const TICK_MS = 1000;

export interface RunningAgentInfo {
	agentType: string;
	description: string;
	startedAt: number;
	status: TaskStatus;
	endedAt?: number;
	toolUses: number;
	totalTokens: number;
	/** Latest tool call, for example "read ~/src/index.ts". */
	activity?: string;
}

function statusMark(status: TaskStatus): string {
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

/** One panel line, for example "● explore: find config files · 1m 12s · 3 tool uses · read ~/x.ts · 12k tokens". */
export function formatRunningAgentLine(agent: RunningAgentInfo, now: number): string {
	const stats = [formatElapsed((agent.endedAt ?? now) - agent.startedAt)];
	if (agent.toolUses > 0) stats.push(`${agent.toolUses} tool use${agent.toolUses === 1 ? "" : "s"}`);
	if (agent.status === "running" && agent.activity) stats.push(agent.activity.replace(/\s+/g, " "));
	if (agent.totalTokens > 0) stats.push(`${formatTokenCount(agent.totalTokens)} tokens`);
	const title = `${agent.agentType}: ${agent.description.replace(/\s+/g, " ").trim()}`;
	return `${statusMark(agent.status)} ${theme.fg("text", title)}${theme.fg("dim", ` · ${stats.join(" · ")}`)}`;
}

/**
 * Compact list of running subagents below the editor, one line each. Finished agents keep their mark for a few
 * seconds, then leave; the panel renders nothing when empty. It re-renders once a second only while an agent runs.
 */
export class RunningAgentsPanel implements Component {
	private readonly agents = new Map<string, RunningAgentInfo>();
	private readonly removalTimers = new Map<string, NodeJS.Timeout>();
	private readonly requestRender: () => void;
	private readonly lingerMs: number;
	private tickTimer: NodeJS.Timeout | undefined;

	constructor(requestRender: () => void, lingerMs = FINISHED_LINGER_MS) {
		this.requestRender = requestRender;
		this.lingerMs = lingerMs;
	}

	/** Add or update an agent. A finished status starts its removal countdown. */
	set(id: string, info: RunningAgentInfo): void {
		const wasRunning = this.agents.get(id)?.status === "running";
		this.agents.set(id, info);
		if (info.status !== "running" && (wasRunning || !this.removalTimers.has(id))) {
			const existing = this.removalTimers.get(id);
			if (existing) clearTimeout(existing);
			const timer = setTimeout(() => this.remove(id), this.lingerMs);
			timer.unref?.();
			this.removalTimers.set(id, timer);
		}
		this.changed();
	}

	get(id: string): RunningAgentInfo | undefined {
		return this.agents.get(id);
	}

	remove(id: string): void {
		const timer = this.removalTimers.get(id);
		if (timer) clearTimeout(timer);
		this.removalTimers.delete(id);
		if (this.agents.delete(id)) this.changed();
	}

	/** Mark every running agent whose id matches `filter` as finished with `status`. */
	finishRunning(status: Exclude<TaskStatus, "running">, filter: (id: string) => boolean = () => true): void {
		for (const [id, agent] of this.agents) {
			if (agent.status === "running" && filter(id)) this.set(id, { ...agent, status, endedAt: Date.now() });
		}
	}

	clear(): void {
		for (const timer of this.removalTimers.values()) clearTimeout(timer);
		this.removalTimers.clear();
		this.agents.clear();
		this.changed();
	}

	dispose(): void {
		this.clear();
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (this.agents.size === 0) return [];
		const now = Date.now();
		const all = [...this.agents.values()];
		// Running agents first, so lingering finished ones never push them below the cap.
		const ordered = [...all.filter((a) => a.status === "running"), ...all.filter((a) => a.status !== "running")];
		const visible = ordered.length > MAX_VISIBLE_AGENTS ? ordered.slice(0, MAX_VISIBLE_AGENTS - 1) : ordered;
		const lines = visible.map((agent) => formatRunningAgentLine(agent, now));
		const hidden = ordered.length - visible.length;
		if (hidden > 0) lines.push(theme.fg("dim", `+${hidden} more`));
		const contentWidth = Math.max(1, width - 1);
		return lines.map((line) => ` ${truncateToWidth(line, contentWidth, "…")}`);
	}

	private changed(): void {
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

const TOOL_PREFIX = "tool:";
const TASK_PREFIX = "task:";

function fromDetails(
	previous: RunningAgentInfo | undefined,
	details: Partial<AgentToolDetails> | undefined,
): Partial<RunningAgentInfo> {
	if (!details) return {};
	return {
		...(details.toolUses !== undefined ? { toolUses: details.toolUses } : {}),
		...(details.usage ? { totalTokens: details.usage.totalTokens } : {}),
		activity: details.activity?.at(-1) ?? previous?.activity,
	};
}

function fromTask(task: TaskInfo): RunningAgentInfo {
	return {
		agentType: task.agentType ?? "agent",
		description: task.description,
		startedAt: task.startedAt,
		status: task.status,
		endedAt: task.endedAt,
		toolUses: task.usage?.toolUses ?? 0,
		totalTokens: task.usage?.totalTokens ?? 0,
		activity: task.activity?.at(-1),
	};
}

function stringArg(args: unknown, name: string): string | undefined {
	const value = (args as Record<string, unknown> | undefined)?.[name];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Keep `panel` in sync with the session's subagents: foreground `agent` tool calls through their tool events, and
 * background agents through the task registry. Returns the unsubscribe function.
 */
export function trackRunningAgents(
	session: Pick<AgentSession, "subscribe" | "tasks">,
	panel: RunningAgentsPanel,
): () => void {
	panel.clear();
	for (const task of session.tasks.running()) {
		if (task.kind === "agent") panel.set(TASK_PREFIX + task.id, fromTask(task));
	}
	const unsubscribeTasks = session.tasks.subscribe((event) => {
		if (event.task.kind !== "agent") return;
		if (event.type === "started" || event.type === "updated" || event.type === "finished") {
			panel.set(TASK_PREFIX + event.task.id, fromTask(event.task));
		}
	});
	const unsubscribeSession = session.subscribe((event) => {
		if (event.type === "agent_end") {
			// A foreground call that never reported its end was cut off with the run.
			panel.finishRunning("stopped", (id) => id.startsWith(TOOL_PREFIX));
			return;
		}
		if (
			event.type !== "tool_execution_start" &&
			event.type !== "tool_execution_update" &&
			event.type !== "tool_execution_end"
		) {
			return;
		}
		if (event.toolName !== "agent") return;
		const id = TOOL_PREFIX + event.toolCallId;
		const previous = panel.get(id);
		if (event.type === "tool_execution_start") {
			// A background launch returns at once; its task entry shows the agent.
			if ((event.args as Record<string, unknown> | undefined)?.run_in_background === true) return;
			panel.set(id, {
				agentType: stringArg(event.args, "subagent_type") ?? "general-purpose",
				description: stringArg(event.args, "description") ?? "",
				startedAt: Date.now(),
				status: "running",
				toolUses: 0,
				totalTokens: 0,
			});
			return;
		}
		if (!previous) return;
		if (event.type === "tool_execution_update") {
			const details = (event.partialResult as { details?: Partial<AgentToolDetails> } | undefined)?.details;
			panel.set(id, { ...previous, ...fromDetails(previous, details) });
			return;
		}
		const details = (event.result as { details?: Partial<AgentToolDetails> } | undefined)?.details;
		panel.set(id, {
			...previous,
			...fromDetails(previous, details),
			status: event.isError ? "failed" : "completed",
			endedAt: Date.now(),
		});
	});
	return () => {
		unsubscribeTasks();
		unsubscribeSession();
		panel.clear();
	};
}
