/**
 * Interactive monitoring of background tasks and subagents: a footer status with the number of
 * running tasks, the `/tasks` command to inspect and stop tasks, the chat rendering of task
 * notifications, and the `/agents` command to manage agent types.
 */

import { Container, Text } from "@akramcode/tui";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../../core/extensions/types.ts";
import {
	describeTaskOutcome,
	formatElapsed,
	formatTokenCount,
	readTaskOutputTail,
	TASK_NOTIFICATION_CUSTOM_TYPE,
	type TaskNotificationDetails,
} from "../../core/tasks/notifications.ts";
import type { TaskInfo, TaskRegistry } from "../../core/tasks/task-registry.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { notifyAgentWarnings, showAgents } from "./agents.ts";

const STATUS_KEY = "tasks";
const OUTPUT_TAIL_LINES = 20;
const OUTPUT_TAIL_BYTES = 16 * 1024;

/** The last lines of a task output file. */
export function readOutputTail(path: string, maxLines = OUTPUT_TAIL_LINES): string[] {
	return readTaskOutputTail(path, maxLines, OUTPUT_TAIL_BYTES);
}

function truncate(text: string, max: number): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function statusColor(status: TaskInfo["status"]): "success" | "error" | "warning" | "accent" {
	switch (status) {
		case "completed":
			return "success";
		case "failed":
			return "error";
		case "stopped":
			return "warning";
		default:
			return "accent";
	}
}

/** One line per task for the `/tasks` list, for example `b1  running  bash: npm test · 12s`. */
export function formatTaskListItem(task: TaskInfo, now = Date.now()): string {
	const elapsed = formatElapsed((task.endedAt ?? now) - task.startedAt);
	const parts = [`${task.id}`, task.status, `${task.kind}: ${truncate(task.description, 50)}`];
	const stats = [elapsed];
	if (task.usage) stats.push(`${formatTokenCount(task.usage.totalTokens)} tokens`);
	if (task.exitCode !== undefined) stats.push(`exit ${task.exitCode}`);
	return `${parts.join("  ")} · ${stats.join(" · ")}`;
}

/** Text of the `/tasks` detail view: header, agent activity, and the tail of the output file. */
export function formatTaskDetail(task: TaskInfo, now = Date.now()): string {
	const lines = [
		`${task.kind} task ${task.id}: ${task.description}`,
		`Status: ${task.status} · ${formatElapsed((task.endedAt ?? now) - task.startedAt)}${task.exitCode !== undefined ? ` · exit ${task.exitCode}` : ""}`,
	];
	if (task.command) lines.push(`Command: ${truncate(task.command, 200)}`);
	if (task.agentType) lines.push(`Agent type: ${task.agentType}`);
	if (task.usage) {
		lines.push(
			`Usage: ${task.usage.toolUses} tool uses · ${formatTokenCount(task.usage.totalTokens)} tokens · ${task.usage.turns} turns`,
		);
	}
	if (task.error) lines.push(`Error: ${task.error}`);
	lines.push(`Output: ${task.outputFile}`);
	if (task.transcriptFile) lines.push(`Transcript: ${task.transcriptFile}`);
	const tail = readOutputTail(task.outputFile);
	lines.push("", tail.length > 0 ? tail.join("\n") : "(no output yet)");
	return lines.join("\n");
}

/** One line for a task notification in the chat, for example `● task b1 (bash: npm test) completed · exit 0`. */
export function formatNotificationLine(details: TaskNotificationDetails, theme: Theme): string {
	const task = details.task;
	const subject = `task ${task.id} (${task.kind}: ${truncate(task.description, 60)})`;
	if (details.event === "output") {
		const count = (details.lines?.length ?? 0) + (details.omittedLines ?? 0);
		return `${theme.fg("accent", "●")} ${theme.fg("text", subject)} ${theme.fg("muted", `· ${count} new line${count === 1 ? "" : "s"}`)}`;
	}
	const [status, ...rest] = describeTaskOutcome(task).split(" · ");
	return `${theme.fg(statusColor(task.status), "●")} ${theme.fg("text", subject)} ${theme.fg(statusColor(task.status), status)}${rest.length > 0 ? theme.fg("muted", ` · ${rest.join(" · ")}`) : ""}`;
}

function renderNotification(details: TaskNotificationDetails, expanded: boolean, outputPad: number, theme: Theme) {
	const container = new Container();
	container.addChild(new Text(formatNotificationLine(details, theme), outputPad, 0));
	if (expanded) {
		const body =
			details.event === "output"
				? (details.lines ?? []).join("\n")
				: (details.task.result ?? details.task.error ?? `Output: ${details.task.outputFile}`);
		if (body) container.addChild(new Text(theme.fg("muted", body), outputPad + 2, 0));
	}
	return container;
}

async function showTaskDetail(
	ctx: ExtensionCommandContext,
	tasks: TaskRegistry,
	id: string,
): Promise<"back" | "close"> {
	while (true) {
		const task = tasks.get(id);
		if (!task) return "back";
		const actions = task.status === "running" ? ["Refresh", "Stop task", "Back"] : ["Back"];
		const choice = await ctx.ui.select(formatTaskDetail(task), actions);
		if (choice === undefined) return "close";
		if (choice === "Back") return "back";
		if (choice === "Stop task") {
			tasks.stop(id);
			ctx.ui.notify(`Stopping task ${id}`, "info");
		}
	}
}

async function showTasks(ctx: ExtensionCommandContext): Promise<void> {
	const tasks = ctx.tasks;
	if (!tasks) {
		ctx.ui.notify("Background tasks are not available in this session", "warning");
		return;
	}
	while (true) {
		const list = tasks.list().reverse();
		if (list.length === 0) {
			ctx.ui.notify("No background tasks", "info");
			return;
		}
		const now = Date.now();
		const items = list.map((task) => formatTaskListItem(task, now));
		const running = list.filter((task) => task.status === "running").length;
		const choice = await ctx.ui.select(`Background tasks (${running} running)`, items);
		if (choice === undefined) return;
		const task = list[items.indexOf(choice)];
		if (!task) return;
		if ((await showTaskDetail(ctx, tasks, task.id)) === "close") return;
	}
}

export default function tasksExtension(akramcode: ExtensionAPI): void {
	let unsubscribe: (() => void) | undefined;
	const shownAgentWarnings = new Set<string>();

	const updateStatus = (ctx: ExtensionContext, tasks: TaskRegistry) => {
		const running = tasks.running().length;
		ctx.ui.setStatus(
			STATUS_KEY,
			running > 0 ? ctx.ui.theme.fg("accent", `${running} task${running === 1 ? "" : "s"} running`) : undefined,
		);
	};

	akramcode.registerMessageRenderer<TaskNotificationDetails>(
		TASK_NOTIFICATION_CUSTOM_TYPE,
		(message, options, theme) =>
			message.details ? renderNotification(message.details, options.expanded, options.outputPad, theme) : undefined,
	);

	akramcode.on("session_start", (_event, ctx) => {
		unsubscribe?.();
		unsubscribe = undefined;
		notifyAgentWarnings(ctx, shownAgentWarnings);
		const tasks = ctx.tasks;
		if (!tasks || !ctx.hasUI) return;
		updateStatus(ctx, tasks);
		unsubscribe = tasks.subscribe((event) => {
			if (event.type === "started" || event.type === "finished") updateStatus(ctx, tasks);
		});
	});

	akramcode.on("session_shutdown", () => {
		unsubscribe?.();
		unsubscribe = undefined;
	});

	akramcode.registerCommand("tasks", {
		description: "Show background tasks: inspect their output or stop them",
		handler: async (_args, ctx) => showTasks(ctx),
	});

	akramcode.registerCommand("agents", {
		description: "Show agent types for the agent tool; create, edit, or delete them",
		handler: async (_args, ctx) => showAgents(ctx),
	});
}
