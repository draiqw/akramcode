import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { TaskInfo } from "./task-registry.ts";

/** `customType` of the session messages that report background task events. */
export const TASK_NOTIFICATION_CUSTOM_TYPE = "task-notification";

/** Longest agent result a notification carries; the full text stays in the output file. */
const MAX_NOTIFICATION_RESULT_CHARS = 30_000;

/** Output lines a finished bash notification carries. */
const NOTIFICATION_TAIL_LINES = 20;
const NOTIFICATION_TAIL_BYTES = 4 * 1024;

/** The last lines of a task output file, reading at most `maxBytes` from its end. */
export function readTaskOutputTail(path: string, maxLines: number, maxBytes = 16 * 1024): string[] {
	let fd: number | undefined;
	try {
		const size = statSync(path).size;
		const length = Math.min(size, maxBytes);
		const buffer = Buffer.alloc(length);
		fd = openSync(path, "r");
		readSync(fd, buffer, 0, length, size - length);
		const lines = buffer.toString("utf-8").split("\n");
		// The first line may be cut by the byte limit.
		if (length < size) lines.shift();
		while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
		return lines.slice(-maxLines);
	} catch {
		return [];
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

export interface TaskNotificationDetails {
	task: TaskInfo;
	/** `finished` when the task ended, `output` for lines a monitor delivers. */
	event: "finished" | "output";
	lines?: string[];
	omittedLines?: number;
}

export function formatTokenCount(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatElapsed(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** One-line summary of a task, for example `bash: npm test · completed · exit 0`. */
export function describeTaskOutcome(task: TaskInfo): string {
	const parts: string[] = [task.status];
	if (task.exitCode !== undefined) parts.push(`exit ${task.exitCode}`);
	if (task.usage) {
		parts.push(`${task.usage.toolUses} tool use${task.usage.toolUses === 1 ? "" : "s"}`);
		parts.push(`${formatTokenCount(task.usage.totalTokens)} tokens`);
	}
	if (task.endedAt !== undefined) parts.push(formatElapsed(task.endedAt - task.startedAt));
	return parts.join(" · ");
}

function finishedSummary(task: TaskInfo): string {
	const subject =
		task.kind === "agent"
			? `Agent "${task.description}"`
			: task.kind === "monitor"
				? `Monitor "${task.description}"`
				: `Background command "${task.description}"`;
	switch (task.status) {
		case "completed":
			return task.exitCode !== undefined
				? `${subject} completed (exit code ${task.exitCode})`
				: `${subject} completed`;
		case "failed":
			return `${subject} failed${task.exitCode !== undefined ? ` with exit code ${task.exitCode}` : ""}${task.error ? `: ${task.error}` : ""}`;
		case "stopped":
			return `${subject} was stopped`;
		default:
			return `${subject} is running`;
	}
}

/** Text the model receives when a task finishes. */
export function formatTaskFinishedNotification(task: TaskInfo): string {
	const lines = [
		"<task-notification>",
		`<task-id>${task.id}</task-id>`,
		`<kind>${task.kind}</kind>`,
		`<status>${task.status}</status>`,
		`<summary>${finishedSummary(task)}</summary>`,
	];
	if (task.kind === "bash") {
		const tail = readTaskOutputTail(task.outputFile, NOTIFICATION_TAIL_LINES, NOTIFICATION_TAIL_BYTES);
		if (tail.length > 0) lines.push(`<output-tail>\n${tail.join("\n")}\n</output-tail>`);
	}
	if (task.result !== undefined) {
		const result =
			task.result.length > MAX_NOTIFICATION_RESULT_CHARS
				? `${task.result.slice(0, MAX_NOTIFICATION_RESULT_CHARS)}\n[Result truncated. Full text: ${task.outputFile}]`
				: task.result;
		lines.push(`<result>\n${result}\n</result>`);
	}
	lines.push(`<output-file>${task.outputFile}</output-file>`, "</task-notification>");
	if (task.kind === "bash") {
		lines.push(
			`The output tail shows at most the last ${NOTIFICATION_TAIL_LINES} lines; read the output file for more.`,
		);
	}
	return lines.join("\n");
}

/** Text the model receives when a monitor delivers output lines. */
export function formatTaskOutputNotification(task: TaskInfo, outputLines: string[], omittedLines: number): string {
	const lines = [
		"<task-notification>",
		`<task-id>${task.id}</task-id>`,
		`<kind>${task.kind}</kind>`,
		`<status>${task.status}</status>`,
		`<summary>Monitor "${task.description}" produced output</summary>`,
		`<event>\n${outputLines.join("\n")}${omittedLines > 0 ? `\n[${omittedLines} more lines in ${task.outputFile}]` : ""}\n</event>`,
		"</task-notification>",
	];
	return lines.join("\n");
}
