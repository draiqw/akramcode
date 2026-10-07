import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";

export type TaskKind = "bash" | "agent" | "monitor";
export type TaskStatus = "running" | "completed" | "failed" | "stopped";

/** Token usage of an agent task. */
export interface TaskUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: number;
	turns: number;
	toolUses: number;
}

export function emptyTaskUsage(): TaskUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0, turns: 0, toolUses: 0 };
}

/** Snapshot of a background task. */
export interface TaskInfo {
	/** Short id, for example `b1` (bash), `a1` (agent), or `m1` (monitor). */
	id: string;
	kind: TaskKind;
	description: string;
	status: TaskStatus;
	startedAt: number;
	endedAt?: number;
	/** File the task output streams to. */
	outputFile: string;
	/** Shell command of bash and monitor tasks. */
	command?: string;
	/** Agent type of agent tasks. */
	agentType?: string;
	/** Exit code of bash and monitor tasks. */
	exitCode?: number;
	/** Error message of failed tasks. */
	error?: string;
	/** Final text of agent tasks. */
	result?: string;
	/** Usage of agent tasks. */
	usage?: TaskUsage;
	/** Recent activity of agent tasks, oldest first. */
	activity?: string[];
	/** Transcript file of agent tasks. */
	transcriptFile?: string;
}

export interface TaskOutcome {
	status: Exclude<TaskStatus, "running">;
	exitCode?: number;
	error?: string;
	result?: string;
}

export type TaskEvent =
	| { type: "started"; task: TaskInfo }
	| { type: "updated"; task: TaskInfo }
	/** Lines a monitor task delivers to the session. */
	| { type: "output"; task: TaskInfo; lines: string[]; omittedLines: number }
	| { type: "finished"; task: TaskInfo; notify: boolean };

export interface CreateTaskInput {
	kind: TaskKind;
	description: string;
	command?: string;
	agentType?: string;
}

/** Handle the code running a task uses to report output and completion. */
export interface TaskHandle {
	readonly id: string;
	/** Aborted when the task is stopped. */
	readonly signal: AbortSignal;
	readonly outputFile: string;
	/** Append raw output to the output file. */
	write(data: string | Buffer): void;
	/** Update the snapshot, for example agent usage and activity. */
	update(patch: Partial<Pick<TaskInfo, "usage" | "activity" | "transcriptFile">>): void;
	/** Deliver lines to the session (monitor tasks). */
	emitOutput(lines: string[], omittedLines?: number): void;
	/** Mark the task as finished. A stopped task always finishes as `stopped`. Later calls are ignored. */
	finish(outcome: TaskOutcome): Promise<void>;
}

interface TaskEntry {
	info: TaskInfo;
	controller: AbortController;
	stream: WriteStream | undefined;
	notifyOnFinish: boolean;
	finished: boolean;
}

const ID_PREFIX: Record<TaskKind, string> = { bash: "b", agent: "a", monitor: "m" };

/**
 * Background tasks of one session: background bash commands, background agents, and monitors.
 * Output streams to one file per task. Listeners receive start, update, output, and finish events;
 * the session turns `output` and notifying `finished` events into task notifications.
 */
export class TaskRegistry {
	private readonly entries = new Map<string, TaskEntry>();
	private readonly listeners = new Set<(event: TaskEvent) => void>();
	private readonly counters: Record<TaskKind, number> = { bash: 0, agent: 0, monitor: 0 };
	private readonly getOutputDir: () => string;
	private outputDir: string | undefined;

	constructor(options: { outputDir: () => string }) {
		this.getOutputDir = options.outputDir;
	}

	/** Register a running task and open its output file. */
	create(input: CreateTaskInput): TaskHandle {
		this.counters[input.kind]++;
		const id = `${ID_PREFIX[input.kind]}${this.counters[input.kind]}`;
		this.outputDir ??= this.getOutputDir();
		mkdirSync(this.outputDir, { recursive: true });
		const outputFile = join(this.outputDir, `${id}.output`);
		const entry: TaskEntry = {
			info: {
				id,
				kind: input.kind,
				description: input.description,
				status: "running",
				startedAt: Date.now(),
				outputFile,
				...(input.command !== undefined ? { command: input.command } : {}),
				...(input.agentType !== undefined ? { agentType: input.agentType } : {}),
			},
			controller: new AbortController(),
			stream: createWriteStream(outputFile, { flags: "w" }),
			notifyOnFinish: true,
			finished: false,
		};
		// Output files are diagnostics; a failing write must not crash the session.
		entry.stream?.on("error", () => {
			entry.stream = undefined;
		});
		this.entries.set(id, entry);
		this.emit({ type: "started", task: this.snapshot(entry) });

		return {
			id,
			signal: entry.controller.signal,
			outputFile,
			write: (data) => {
				if (!entry.finished) entry.stream?.write(data);
			},
			update: (patch) => {
				if (entry.finished) return;
				Object.assign(entry.info, patch);
				this.emit({ type: "updated", task: this.snapshot(entry) });
			},
			emitOutput: (lines, omittedLines = 0) => {
				if (entry.finished || entry.controller.signal.aborted || lines.length === 0) return;
				this.emit({ type: "output", task: this.snapshot(entry), lines, omittedLines });
			},
			finish: async (outcome) => {
				if (entry.finished) return;
				entry.finished = true;
				// Close the output file first: the task counts as running until its output is complete.
				const stream = entry.stream;
				entry.stream = undefined;
				if (stream) await new Promise<void>((resolve) => stream.end(resolve));
				const stopped = entry.controller.signal.aborted;
				Object.assign(entry.info, {
					status: stopped ? "stopped" : outcome.status,
					endedAt: Date.now(),
					...(outcome.exitCode !== undefined ? { exitCode: outcome.exitCode } : {}),
					...(outcome.error !== undefined && !stopped ? { error: outcome.error } : {}),
					...(outcome.result !== undefined ? { result: outcome.result } : {}),
				});
				this.emit({ type: "finished", task: this.snapshot(entry), notify: entry.notifyOnFinish });
			},
		};
	}

	get(id: string): TaskInfo | undefined {
		const entry = this.entries.get(id);
		return entry ? this.snapshot(entry) : undefined;
	}

	/** All tasks, oldest first. */
	list(): TaskInfo[] {
		return [...this.entries.values()].map((entry) => this.snapshot(entry));
	}

	/** Running tasks, oldest first. */
	running(): TaskInfo[] {
		return this.list().filter((task) => task.status === "running");
	}

	/**
	 * Stop a running task. With `notify: false` the session gets no notification when it ends,
	 * for example because the model stopped it itself.
	 * @returns false when no running task has this id.
	 */
	stop(id: string, options?: { notify?: boolean }): boolean {
		const entry = this.entries.get(id);
		if (!entry || entry.finished || entry.info.status !== "running") return false;
		if (options?.notify === false) entry.notifyOnFinish = false;
		entry.controller.abort();
		return true;
	}

	/** Stop all running tasks without notifications. */
	stopAll(): void {
		for (const entry of this.entries.values()) {
			if (!entry.finished) {
				entry.notifyOnFinish = false;
				entry.controller.abort();
			}
		}
	}

	subscribe(listener: (event: TaskEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Resolve on the next `output` or `finished` event, or after `timeoutMs`. */
	waitForActivity(timeoutMs: number): Promise<void> {
		return new Promise((resolve) => {
			const done = () => {
				clearTimeout(timer);
				unsubscribe();
				resolve();
			};
			const timer = setTimeout(done, Math.max(0, timeoutMs));
			const unsubscribe = this.subscribe((event) => {
				if (event.type === "output" || event.type === "finished") done();
			});
		});
	}

	private snapshot(entry: TaskEntry): TaskInfo {
		const info = entry.info;
		return {
			...info,
			...(info.usage ? { usage: { ...info.usage } } : {}),
			...(info.activity ? { activity: [...info.activity] } : {}),
		};
	}

	private emit(event: TaskEvent): void {
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch {
				// A failing listener must not break the task or other listeners.
			}
		}
	}
}
