import type { AssistantMessage, AssistantMessageEvent } from "@akramcode/ai";
import { formatTokens, formatTokensPerSecond } from "./components/footer.ts";

/** Characters per token used for live estimates while a response streams (matches the chars / 4 heuristic used elsewhere). */
const CHARS_PER_TOKEN = 4;
/** Below this streaming time a tokens/s figure is mostly first-chunk noise, so none is reported. */
const MIN_SPEED_WINDOW_MS = 500;

export interface RunStatsSnapshot {
	/** Time since the agent run started. */
	elapsedMs: number;
	/** Output tokens of the run: provider counts for finished responses plus an estimate for the streaming one. */
	outputTokens: number;
	/** Generation speed of the streaming response, or of the last finished one. */
	tokensPerSecond: number | undefined;
}

/**
 * Tracks elapsed time, output tokens, and generation speed of the current agent run for the working indicator
 * and the footer. Speed is measured from the first streamed delta to the last one, so time-to-first-token and
 * tool execution do not count against it.
 */
export class RunStatsTracker {
	private runStartMs: number | undefined;
	private finishedOutputTokens = 0;
	private streamChars = 0;
	private streamFirstDeltaMs: number | undefined;
	private streamLastDeltaMs: number | undefined;
	private lastTokensPerSecond: number | undefined;

	get isRunning(): boolean {
		return this.runStartMs !== undefined;
	}

	/** Speed of the last finished response, kept after the run ends for the footer. */
	get lastSpeed(): number | undefined {
		return this.lastTokensPerSecond;
	}

	startRun(now: number): void {
		this.runStartMs = now;
		this.finishedOutputTokens = 0;
		this.resetStream();
	}

	endRun(): void {
		this.runStartMs = undefined;
		this.resetStream();
	}

	/** Counts streamed characters. Only delta events carry new output. */
	onUpdate(event: AssistantMessageEvent, now: number): void {
		if (event.type !== "text_delta" && event.type !== "thinking_delta" && event.type !== "toolcall_delta") return;
		if (event.delta.length === 0) return;
		this.streamFirstDeltaMs ??= now;
		this.streamLastDeltaMs = now;
		this.streamChars += event.delta.length;
	}

	/** Replaces the streaming estimate with the provider's output count when it reports one. */
	onMessageEnd(message: AssistantMessage): void {
		const estimated = this.estimateStreamTokens();
		const tokens = message.usage.output > 0 ? message.usage.output : estimated;
		this.finishedOutputTokens += tokens;
		const speed = this.speed(tokens);
		if (speed !== undefined) this.lastTokensPerSecond = speed;
		this.resetStream();
	}

	snapshot(now: number): RunStatsSnapshot {
		const streamTokens = this.estimateStreamTokens();
		return {
			elapsedMs: this.runStartMs === undefined ? 0 : Math.max(0, now - this.runStartMs),
			outputTokens: this.finishedOutputTokens + streamTokens,
			tokensPerSecond: this.speed(streamTokens) ?? this.lastTokensPerSecond,
		};
	}

	private speed(tokens: number): number | undefined {
		if (this.streamFirstDeltaMs === undefined || this.streamLastDeltaMs === undefined || tokens <= 0)
			return undefined;
		const windowMs = this.streamLastDeltaMs - this.streamFirstDeltaMs;
		if (windowMs < MIN_SPEED_WINDOW_MS) return undefined;
		return tokens / (windowMs / 1000);
	}

	private estimateStreamTokens(): number {
		return Math.round(this.streamChars / CHARS_PER_TOKEN);
	}

	private resetStream(): void {
		this.streamChars = 0;
		this.streamFirstDeltaMs = undefined;
		this.streamLastDeltaMs = undefined;
	}
}

/** Formats elapsed time as `45s`, `3m 05s`, or `1h 02m`. */
export function formatElapsed(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	if (minutes < 60) return `${minutes}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Working-indicator detail, e.g. `1m 05s · ↓ 1.2k tokens · 48.0 tok/s`. Token parts appear once output arrives. */
export function formatRunStats(stats: RunStatsSnapshot): string {
	const parts = [formatElapsed(stats.elapsedMs)];
	if (stats.outputTokens > 0) parts.push(`↓ ${formatTokens(stats.outputTokens)} tokens`);
	if (stats.tokensPerSecond !== undefined) parts.push(formatTokensPerSecond(stats.tokensPerSecond));
	return parts.join(" · ");
}
