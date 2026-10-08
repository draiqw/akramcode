import { Text } from "@akramcode/tui";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { str } from "../tools/render-utils.ts";
import type { TaskRegistry } from "./task-registry.ts";

/** Lines that arrive within this window are delivered together. */
const MONITOR_BATCH_WINDOW_MS = 500;
/** Minimum time between two deliveries of one monitor. */
const MONITOR_MIN_INTERVAL_MS = 2000;
/** Lines one delivery carries at most; the rest are counted and stay in the output file. */
const MONITOR_MAX_LINES_PER_EVENT = 40;
/** Longest line a delivery carries. */
const MONITOR_MAX_LINE_CHARS = 2000;

const taskStopSchema = Type.Object({ task_id: Type.String() });

export type TaskStopToolInput = Static<typeof taskStopSchema>;

export function createTaskStopToolDefinition(tasks: TaskRegistry): ToolDefinition<typeof taskStopSchema> {
	return {
		name: "task_stop",
		label: "task_stop",
		description: "Stop a background task by id.",
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

export interface LineBatcherOptions {
	/** Receives each batch, and the number of lines left out of it. */
	deliver: (lines: string[], omittedLines: number) => void;
	/** Defaults: 500 ms batch window, 2 s between deliveries, 40 lines per delivery. */
	batchWindowMs?: number;
	minIntervalMs?: number;
	maxLinesPerEvent?: number;
}

export interface LineBatcher {
	push(data: Buffer): void;
	/** Deliver the pending lines, including an unterminated last line. */
	flush(): void;
}

/** Splits command output into lines and delivers them in rate-limited batches (bash monitor mode). */
export function createLineBatcher(options: LineBatcherOptions): LineBatcher {
	const batchWindowMs = options.batchWindowMs ?? MONITOR_BATCH_WINDOW_MS;
	const minIntervalMs = options.minIntervalMs ?? MONITOR_MIN_INTERVAL_MS;
	const maxLinesPerEvent = options.maxLinesPerEvent ?? MONITOR_MAX_LINES_PER_EVENT;
	const decoder = new TextDecoder();
	let partialLine = "";
	let pending: string[] = [];
	// Lines past `maxLinesPerEvent` are only counted, so a fast command cannot grow `pending` without bound.
	let omitted = 0;
	let timer: NodeJS.Timeout | undefined;
	let lastDeliveryAt = 0;

	const deliver = () => {
		if (timer) clearTimeout(timer);
		timer = undefined;
		if (pending.length === 0) return;
		const lines = pending;
		const omittedLines = omitted;
		pending = [];
		omitted = 0;
		lastDeliveryAt = Date.now();
		options.deliver(lines, omittedLines);
	};
	const addLine = (line: string) => {
		const trimmed = line.replace(/\r$/, "");
		if (trimmed.length === 0) return;
		if (pending.length >= maxLinesPerEvent) omitted++;
		else
			pending.push(
				trimmed.length > MONITOR_MAX_LINE_CHARS ? `${trimmed.slice(0, MONITOR_MAX_LINE_CHARS)}…` : trimmed,
			);
		timer ??= setTimeout(deliver, Math.max(batchWindowMs, lastDeliveryAt + minIntervalMs - Date.now()));
	};
	return {
		push(data) {
			const lines = (partialLine + decoder.decode(data, { stream: true })).split("\n");
			partialLine = lines.pop() ?? "";
			// An endless line (no newline) must not grow without bound either.
			if (partialLine.length > MONITOR_MAX_LINE_CHARS)
				partialLine = partialLine.slice(0, MONITOR_MAX_LINE_CHARS + 1);
			for (const line of lines) addLine(line);
		},
		flush() {
			addLine(partialLine + decoder.decode());
			partialLine = "";
			deliver();
		},
	};
}
