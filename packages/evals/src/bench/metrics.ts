/**
 * Extracts per-run metrics from the `--mode json` event stream of akramcode.
 *
 * The stream is one JSON object per line. Relevant events:
 * - `message_end` with an assistant message: authoritative per-request usage, stop reason, error.
 * - `turn_end`: one agent turn (one model request plus its tool calls).
 * - `tool_execution_start` / `tool_execution_end`: tool calls and tool errors.
 * - `compaction_end`: threshold, overflow, or manual compaction (summary usage in `result.usage`).
 * - `entry_appended` with a `compaction` entry: online compaction committed at a boundary.
 * - `tool_results_cleared`: old tool results replaced with placeholders.
 * - `auto_retry_start`: provider error retried by the agent.
 *
 * Unknown events are ignored, so older and newer builds can be compared.
 */

export interface TokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** input + output + cacheRead + cacheWrite */
	total: number;
	cost: number;
}

export interface RunMetrics {
	/** Usage of assistant requests plus compaction summaries. */
	usage: TokenUsage;
	/** Usage of compaction summary calls only (already included in `usage`). */
	compactionUsage: TokenUsage;
	requests: number;
	turns: number;
	toolCalls: number;
	toolErrors: number;
	toolCallsByName: Record<string, number>;
	/** Characters of text returned by tools (proxy for tool output volume). */
	toolOutputChars: number;
	/** Largest prompt seen by one request: input + cacheRead + cacheWrite. */
	peakContextTokens: number;
	compactions: number;
	compactionFailures: number;
	toolResultClears: number;
	toolResultsCleared: number;
	autoRetries: number;
	/** Assistant requests that ended with stopReason "error". */
	requestErrors: number;
	errorMessages: string[];
	finalStopReason: string | undefined;
	finalText: string;
	/** Lines that were not valid JSON (e.g. stray stdout writes). */
	invalidLines: number;
	sawAgentEnd: boolean;
}

export function emptyUsage(): TokenUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 };
}

export function addUsage(target: TokenUsage, source: TokenUsage): void {
	target.input += source.input;
	target.output += source.output;
	target.cacheRead += source.cacheRead;
	target.cacheWrite += source.cacheWrite;
	target.total += source.total;
	target.cost += source.cost;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Normalizes a provider `Usage` object. `total` is recomputed, not trusted. */
export function readUsage(value: unknown): TokenUsage {
	if (!isObject(value)) return emptyUsage();
	const input = num(value.input);
	const output = num(value.output);
	const cacheRead = num(value.cacheRead);
	const cacheWrite = num(value.cacheWrite);
	const cost = isObject(value.cost) ? num(value.cost.total) : 0;
	return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite, cost };
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	let text = "";
	for (const part of content) {
		if (isObject(part) && part.type === "text" && typeof part.text === "string") text += part.text;
	}
	return text;
}

export function createMetrics(): RunMetrics {
	return {
		usage: emptyUsage(),
		compactionUsage: emptyUsage(),
		requests: 0,
		turns: 0,
		toolCalls: 0,
		toolErrors: 0,
		toolCallsByName: {},
		toolOutputChars: 0,
		peakContextTokens: 0,
		compactions: 0,
		compactionFailures: 0,
		toolResultClears: 0,
		toolResultsCleared: 0,
		autoRetries: 0,
		requestErrors: 0,
		errorMessages: [],
		finalStopReason: undefined,
		finalText: "",
		invalidLines: 0,
		sawAgentEnd: false,
	};
}

const MAX_ERROR_MESSAGES = 10;

function recordError(metrics: RunMetrics, message: string): void {
	if (metrics.errorMessages.length < MAX_ERROR_MESSAGES) metrics.errorMessages.push(message.slice(0, 500));
}

/** Applies one parsed event to the metrics accumulator. */
export function applyEvent(metrics: RunMetrics, event: unknown): void {
	if (!isObject(event) || typeof event.type !== "string") return;
	switch (event.type) {
		case "message_end": {
			const message = event.message;
			if (!isObject(message) || message.role !== "assistant") return;
			const usage = readUsage(message.usage);
			addUsage(metrics.usage, usage);
			metrics.requests++;
			metrics.peakContextTokens = Math.max(
				metrics.peakContextTokens,
				usage.input + usage.cacheRead + usage.cacheWrite,
			);
			metrics.finalStopReason = typeof message.stopReason === "string" ? message.stopReason : undefined;
			const text = textOf(message.content);
			if (text.trim()) metrics.finalText = text;
			if (message.stopReason === "error") {
				metrics.requestErrors++;
				recordError(
					metrics,
					typeof message.errorMessage === "string" ? message.errorMessage : "assistant request failed",
				);
			}
			return;
		}
		case "turn_end":
			metrics.turns++;
			return;
		case "tool_execution_start": {
			metrics.toolCalls++;
			const name = typeof event.toolName === "string" ? event.toolName : "unknown";
			metrics.toolCallsByName[name] = (metrics.toolCallsByName[name] ?? 0) + 1;
			return;
		}
		case "tool_execution_end": {
			if (event.isError === true) metrics.toolErrors++;
			if (isObject(event.result)) metrics.toolOutputChars += textOf(event.result.content).length;
			return;
		}
		case "compaction_end": {
			if (typeof event.errorMessage === "string") {
				metrics.compactionFailures++;
				recordError(metrics, `compaction: ${event.errorMessage}`);
			}
			if (event.aborted === true || !isObject(event.result)) return;
			metrics.compactions++;
			const usage = readUsage(event.result.usage);
			addUsage(metrics.compactionUsage, usage);
			addUsage(metrics.usage, usage);
			return;
		}
		case "entry_appended": {
			const entry = event.entry;
			if (!isObject(entry) || entry.type !== "compaction") return;
			metrics.compactions++;
			const usage = readUsage(entry.usage);
			addUsage(metrics.compactionUsage, usage);
			addUsage(metrics.usage, usage);
			return;
		}
		case "tool_results_cleared":
			metrics.toolResultClears++;
			metrics.toolResultsCleared += num(event.count);
			return;
		case "auto_retry_start":
			metrics.autoRetries++;
			return;
		case "auto_retry_end":
			if (event.success === false && typeof event.finalError === "string") recordError(metrics, event.finalError);
			return;
		case "agent_end":
			metrics.sawAgentEnd = true;
			return;
	}
}

/** Parses a whole JSONL event stream. */
export function metricsFromJsonl(text: string): RunMetrics {
	const metrics = createMetrics();
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let event: unknown;
		try {
			event = JSON.parse(trimmed);
		} catch {
			metrics.invalidLines++;
			continue;
		}
		applyEvent(metrics, event);
	}
	return metrics;
}
