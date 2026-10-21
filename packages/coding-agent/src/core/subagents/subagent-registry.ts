import type { AgentMessage } from "@akramcode/agent-core";
import type { AssistantMessage } from "@akramcode/ai";
import type { AgentSession } from "../agent-session.ts";

export type SubagentStatus = "running" | "completed" | "failed" | "stopped";

/** Token usage of a subagent, over all its runs. */
export interface SubagentUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: number;
	turns: number;
	toolUses: number;
}

export function emptySubagentUsage(): SubagentUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0, turns: 0, toolUses: 0 };
}

/** Who started a run: the main agent (`agent` or `agent_message`) or the user from the agent's chat. */
export type SubagentRunSource = "agent" | "user";

/** Snapshot of a subagent. */
export interface SubagentInfo {
	/** Short id, for example `a1`. */
	id: string;
	agentType: string;
	description: string;
	/** `provider/id` of the model. */
	model?: string;
	status: SubagentStatus;
	/** Whether the main agent waits for the current or last run (a foreground `agent` call). */
	foreground: boolean;
	/** Who started the current or last run. */
	source: SubagentRunSource;
	/** Message that started the current or last run. */
	prompt: string;
	startedAt: number;
	/** Start of the current or last run. */
	runStartedAt: number;
	/** End of the last run, unset while running. */
	endedAt?: number;
	/** Time spent running over all finished runs. */
	activeMs: number;
	usage: SubagentUsage;
	/** Recent tool calls, oldest first. */
	activity: string[];
	transcriptFile?: string;
	/** Final text of the last completed run. */
	result?: string;
	/** Error of the last failed run. */
	error?: string;
}

/** Running time over all runs, including the current one. */
export function subagentElapsedMs(agent: SubagentInfo, now = Date.now()): number {
	return agent.activeMs + (agent.status === "running" ? now - agent.runStartedAt : 0);
}

export type SubagentEvent =
	| { type: "started"; agent: SubagentInfo }
	| { type: "updated"; agent: SubagentInfo }
	/** `notify`: the main agent should hear about the result; it does not wait for this run. */
	| { type: "finished"; agent: SubagentInfo; notify: boolean };

export interface AddSubagentInput {
	agentType: string;
	description: string;
	session: AgentSession;
	/** Describes a tool call of the child for the activity list, for example `read ~/src/index.ts`. */
	describeToolCall: (toolName: string, args: Record<string, unknown> | undefined) => string;
}

export interface SubagentRunOptions {
	foreground: boolean;
	source: SubagentRunSource;
	/** Aborts the run, for example when the main agent's tool call is aborted. */
	signal?: AbortSignal;
}

export interface SubagentRunResult {
	status: Exclude<SubagentStatus, "running">;
	text: string;
	error?: string;
}

interface SubagentEntry {
	info: SubagentInfo;
	session: AgentSession;
	unsubscribe: () => void;
	run: Promise<SubagentRunResult> | undefined;
	stopRequested: boolean;
	notifyOnFinish: boolean;
}

/** Recent tool calls kept per agent. */
const MAX_ACTIVITY_ITEMS = 20;

function finalText(messages: readonly AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") continue;
		const text = message.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.trim();
		if (text) return text;
	}
	return "";
}

/**
 * Subagents of one session, foreground and background. Each keeps its child session after a run, so
 * the user can open its chat and both the user and the main agent can message it again. A message
 * to a running agent steers it; a message to a finished agent starts a new run whose result is
 * delivered to the main agent as a notification.
 */
export class SubagentRegistry {
	private readonly entries = new Map<string, SubagentEntry>();
	private readonly listeners = new Set<(event: SubagentEvent) => void>();
	private counter = 0;
	private disposed = false;

	add(input: AddSubagentInput): SubagentInfo {
		const id = `a${++this.counter}`;
		const session = input.session;
		const now = Date.now();
		const entry: SubagentEntry = {
			info: {
				id,
				agentType: input.agentType,
				description: input.description,
				model: session.model ? `${session.model.provider}/${session.model.id}` : undefined,
				status: "completed",
				foreground: false,
				source: "agent",
				prompt: "",
				startedAt: now,
				runStartedAt: now,
				activeMs: 0,
				usage: emptySubagentUsage(),
				activity: [],
				transcriptFile: session.sessionFile,
			},
			session,
			unsubscribe: () => {},
			run: undefined,
			stopRequested: false,
			notifyOnFinish: true,
		};
		entry.unsubscribe = session.subscribe((event) => {
			const info = entry.info;
			if (event.type === "tool_execution_start") {
				info.usage.toolUses++;
				info.activity = [
					...info.activity,
					input.describeToolCall(event.toolName, event.args as Record<string, unknown> | undefined),
				].slice(-MAX_ACTIVITY_ITEMS);
			} else if (event.type === "message_end" && event.message.role === "assistant") {
				const usage = (event.message as AssistantMessage).usage;
				info.usage.turns++;
				info.usage.input += usage.input;
				info.usage.output += usage.output;
				info.usage.cacheRead += usage.cacheRead;
				info.usage.cacheWrite += usage.cacheWrite;
				info.usage.totalTokens += usage.totalTokens;
				info.usage.cost += usage.cost.total;
			} else {
				return;
			}
			this.emit({ type: "updated", agent: this.snapshot(entry) });
		});
		this.entries.set(id, entry);
		return this.snapshot(entry);
	}

	/**
	 * Run `prompt` in the agent's session to completion. Resolves with the outcome; never rejects.
	 * @throws Error when the agent is already running.
	 */
	run(id: string, prompt: string, options: SubagentRunOptions): Promise<SubagentRunResult> {
		const entry = this.requireEntry(id);
		if (entry.run) throw new Error(`Agent ${id} is already running`);
		const info = entry.info;
		Object.assign(info, {
			status: "running",
			foreground: options.foreground,
			source: options.source,
			prompt,
			runStartedAt: Date.now(),
			endedAt: undefined,
			result: undefined,
			error: undefined,
		});
		entry.stopRequested = false;
		entry.notifyOnFinish = true;
		this.emit({ type: "started", agent: this.snapshot(entry) });
		const run = this.execute(entry, prompt, options.signal);
		entry.run = run;
		return run;
	}

	private async execute(entry: SubagentEntry, prompt: string, signal: AbortSignal | undefined) {
		const session = entry.session;
		const onAbort = () => {
			void session.abort();
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		let result: SubagentRunResult;
		try {
			if (signal?.aborted) throw new Error("Agent aborted");
			await session.prompt(prompt, { expandPromptTemplates: false });
			const last = session.messages.findLast((message): message is AssistantMessage => message.role === "assistant");
			if (signal?.aborted || entry.stopRequested || last?.stopReason === "aborted") {
				result = { status: "stopped", text: finalText(session.messages), error: "Agent aborted" };
			} else if (last?.stopReason === "error") {
				result = { status: "failed", text: "", error: last.errorMessage || "Agent request failed" };
			} else {
				result = { status: "completed", text: finalText(session.messages) || "(no output)" };
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			result =
				signal?.aborted || entry.stopRequested
					? { status: "stopped", text: "", error: "Agent aborted" }
					: { status: "failed", text: "", error: message };
		} finally {
			signal?.removeEventListener("abort", onAbort);
		}
		const info = entry.info;
		const endedAt = Date.now();
		Object.assign(info, {
			status: result.status,
			endedAt,
			activeMs: info.activeMs + (endedAt - info.runStartedAt),
			transcriptFile: session.sessionFile ?? info.transcriptFile,
			...(result.status === "completed" ? { result: result.text } : {}),
			...(result.error && result.status === "failed" ? { error: result.error } : {}),
		});
		entry.run = undefined;
		if (!this.disposed) {
			this.emit({
				type: "finished",
				agent: this.snapshot(entry),
				notify: !info.foreground && entry.notifyOnFinish,
			});
		}
		return result;
	}

	/**
	 * Send a message to an agent. A running agent gets it as a steering message after its current
	 * tool calls; a finished agent starts a new run in the background.
	 * @returns `steered` or `resumed`.
	 */
	async send(id: string, message: string, source: SubagentRunSource): Promise<"steered" | "resumed"> {
		const entry = this.requireEntry(id);
		if (entry.run) {
			await entry.session.prompt(message, { expandPromptTemplates: false, streamingBehavior: "steer" });
			return "steered";
		}
		void this.run(id, message, { foreground: false, source });
		return "resumed";
	}

	/**
	 * Stop a running agent. With `notify: false` the main agent gets no notification, for example
	 * because it stopped the agent itself.
	 * @returns false when the agent is not running.
	 */
	stop(id: string, options?: { notify?: boolean }): boolean {
		const entry = this.entries.get(id);
		if (!entry?.run) return false;
		entry.stopRequested = true;
		if (options?.notify === false) entry.notifyOnFinish = false;
		void entry.session.abort();
		return true;
	}

	get(id: string): SubagentInfo | undefined {
		const entry = this.entries.get(id);
		return entry ? this.snapshot(entry) : undefined;
	}

	/** The child session of an agent, for showing its chat. */
	getSession(id: string): AgentSession | undefined {
		return this.entries.get(id)?.session;
	}

	/** All agents, oldest first. */
	list(): SubagentInfo[] {
		return [...this.entries.values()].map((entry) => this.snapshot(entry));
	}

	/** Running agents the main agent does not wait for; their results arrive as notifications. */
	runningInBackground(): SubagentInfo[] {
		return this.list().filter((agent) => agent.status === "running" && !agent.foreground);
	}

	/** Stop every running agent without notifications. */
	stopAll(): void {
		for (const id of this.entries.keys()) this.stop(id, { notify: false });
	}

	/** Stop all agents and dispose their sessions. */
	dispose(): void {
		this.stopAll();
		this.disposed = true;
		this.listeners.clear();
		for (const entry of this.entries.values()) {
			entry.unsubscribe();
			// A stopped run is still unwinding; dispose its session once it ends.
			if (entry.run) void entry.run.finally(() => entry.session.dispose());
			else entry.session.dispose();
		}
		this.entries.clear();
	}

	subscribe(listener: (event: SubagentEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private requireEntry(id: string): SubagentEntry {
		const entry = this.entries.get(id);
		if (!entry) throw new Error(`No agent with id ${id}`);
		return entry;
	}

	private snapshot(entry: SubagentEntry): SubagentInfo {
		return { ...entry.info, usage: { ...entry.info.usage }, activity: [...entry.info.activity] };
	}

	private emit(event: SubagentEvent): void {
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch {
				// A failing listener must not break the agent or other listeners.
			}
		}
	}
}
