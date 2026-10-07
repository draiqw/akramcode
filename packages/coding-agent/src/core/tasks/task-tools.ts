import { Text } from "@akramcode/tui";
import { type Static, Type } from "typebox";
import { getShellEnv } from "../../utils/shell.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import type { BashOperations } from "../tools/bash.ts";
import { str } from "../tools/render-utils.ts";
import type { TaskRegistry } from "./task-registry.ts";

const DEFAULT_MONITOR_TIMEOUT_SECONDS = 300;
const MAX_MONITOR_TIMEOUT_SECONDS = 3600;
/** Lines that arrive within this window are delivered together. */
const MONITOR_BATCH_WINDOW_MS = 500;
/** Minimum time between two deliveries of one monitor. */
const MONITOR_MIN_INTERVAL_MS = 2000;
/** Lines one delivery carries at most; the rest are counted and stay in the output file. */
const MONITOR_MAX_LINES_PER_EVENT = 40;
/** Longest line a delivery carries. */
const MONITOR_MAX_LINE_CHARS = 2000;

const taskStopSchema = Type.Object({
	task_id: Type.String({ description: "Id of the background task to stop, for example b1, a1, or m1" }),
});

export type TaskStopToolInput = Static<typeof taskStopSchema>;

export function createTaskStopToolDefinition(tasks: TaskRegistry): ToolDefinition<typeof taskStopSchema> {
	return {
		name: "task_stop",
		label: "task_stop",
		description:
			"Stop a running background task (background bash command, background agent, or monitor) by its id. You are not notified about tasks you stop.",
		promptSnippet: "Stop a background task by id",
		parameters: taskStopSchema,
		async execute(_toolCallId, { task_id }) {
			const task = tasks.get(task_id);
			if (!task) throw new Error(`No task with id ${task_id}`);
			if (!tasks.stop(task_id, { notify: false })) {
				throw new Error(`Task ${task_id} is not running (status: ${task.status})`);
			}
			return {
				content: [
					{
						type: "text",
						text: `Stopped task ${task_id} (${task.kind}: ${task.description}). Output so far: ${task.outputFile}`,
					},
				],
				details: { taskId: task_id },
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(
				`${theme.fg("toolTitle", theme.bold("task_stop"))} ${theme.fg("accent", str(args?.task_id) ?? "")}`,
			);
			return text;
		},
	};
}

const monitorSchema = Type.Object({
	command: Type.String({
		description:
			"Shell command to watch. Each line it prints is delivered to you as an event, for example `tail -f server.log | grep --line-buffered ERROR`. Use line-buffered output in pipes.",
	}),
	description: Type.String({ description: "Short description of what is being watched (3-5 words)" }),
	timeout: Type.Optional(
		Type.Number({
			description: `Stop watching after this many seconds (default ${DEFAULT_MONITOR_TIMEOUT_SECONDS}, max ${MAX_MONITOR_TIMEOUT_SECONDS})`,
		}),
	),
});

export type MonitorToolInput = Static<typeof monitorSchema>;

export interface MonitorToolOptions {
	tasks: TaskRegistry;
	cwd: string;
	operations: BashOperations;
	/** Defaults: 500 ms batch window, 2 s between deliveries, 40 lines per delivery. */
	batchWindowMs?: number;
	minIntervalMs?: number;
	maxLinesPerEvent?: number;
}

export function createMonitorToolDefinition(options: MonitorToolOptions): ToolDefinition<typeof monitorSchema> {
	const { tasks, cwd, operations } = options;
	const batchWindowMs = options.batchWindowMs ?? MONITOR_BATCH_WINDOW_MS;
	const minIntervalMs = options.minIntervalMs ?? MONITOR_MIN_INTERVAL_MS;
	const maxLinesPerEvent = options.maxLinesPerEvent ?? MONITOR_MAX_LINES_PER_EVENT;
	return {
		name: "monitor",
		label: "monitor",
		description: `Run a command in the background and receive each line it prints as an event, until the command exits, the timeout passes, or you stop it with task_stop. Lines are batched (at most one event every ${minIntervalMs / 1000} seconds). Use it to wait for log lines, file changes, or a condition, instead of polling with sleep. The command runs in the current working directory.`,
		promptSnippet: "Watch a command's output lines in the background and get them as events",
		parameters: monitorSchema,
		async execute(_toolCallId, { command, description, timeout }, _signal, _onUpdate, ctx) {
			const timeoutSeconds = timeout ?? DEFAULT_MONITOR_TIMEOUT_SECONDS;
			if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > MAX_MONITOR_TIMEOUT_SECONDS) {
				throw new Error(`Invalid timeout: must be between 0 and ${MAX_MONITOR_TIMEOUT_SECONDS} seconds`);
			}
			const task = tasks.create({ kind: "monitor", description, command });
			let partialLine = "";
			let pending: string[] = [];
			let timer: NodeJS.Timeout | undefined;
			let lastDeliveryAt = 0;

			const deliver = () => {
				timer = undefined;
				if (pending.length === 0) return;
				const lines = pending.slice(0, maxLinesPerEvent);
				const omitted = pending.length - lines.length;
				pending = [];
				lastDeliveryAt = Date.now();
				task.emitOutput(lines, omitted);
			};
			const schedule = () => {
				if (timer) return;
				const delay = Math.max(batchWindowMs, lastDeliveryAt + minIntervalMs - Date.now());
				timer = setTimeout(deliver, delay);
			};
			const addLine = (line: string) => {
				const trimmed = line.replace(/\r$/, "");
				if (trimmed.length === 0) return;
				pending.push(
					trimmed.length > MONITOR_MAX_LINE_CHARS ? `${trimmed.slice(0, MONITOR_MAX_LINE_CHARS)}…` : trimmed,
				);
				schedule();
			};
			const decoder = new TextDecoder();
			const onData = (data: Buffer) => {
				task.write(data);
				const lines = (partialLine + decoder.decode(data, { stream: true })).split("\n");
				partialLine = lines.pop() ?? "";
				for (const line of lines) addLine(line);
			};
			const flush = () => {
				addLine(partialLine + decoder.decode());
				partialLine = "";
				if (timer) clearTimeout(timer);
				deliver();
			};

			operations
				.exec(command, ctx?.cwd || cwd, {
					onData,
					signal: task.signal,
					timeout: timeoutSeconds,
					env: getShellEnv(),
				})
				.then(
					({ exitCode }) => {
						flush();
						return task.finish(
							exitCode === 0
								? { status: "completed", exitCode }
								: { status: "failed", exitCode: exitCode ?? undefined },
						);
					},
					(error: unknown) => {
						flush();
						const message = error instanceof Error ? error.message : String(error);
						if (message.startsWith("timeout:")) {
							return task.finish({
								status: "completed",
								result: `Stopped watching after ${timeoutSeconds} seconds`,
							});
						}
						return task.finish({ status: "failed", error: message });
					},
				);

			return {
				content: [
					{
						type: "text",
						text: `Monitor started with ID: ${task.id} (timeout ${timeoutSeconds}s). Each output line is delivered to you as a task notification. Full output: ${task.outputFile}. Use task_stop to stop it.`,
					},
				],
				details: { taskId: task.id, outputFile: task.outputFile },
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const description = str(args?.description);
			const command = str(args?.command);
			text.setText(
				`${theme.fg("toolTitle", theme.bold("monitor"))} ${theme.fg("accent", description ?? "")}${command ? theme.fg("muted", ` $ ${command}`) : ""}`,
			);
			return text;
		},
	};
}
