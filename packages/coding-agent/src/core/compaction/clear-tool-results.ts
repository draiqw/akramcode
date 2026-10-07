/**
 * Clearing of old tool results before a summary.
 *
 * When the context crosses the compaction threshold, old large tool results are usually what fills
 * it. Replacing them with a short placeholder (an append-only context edit) frees that space without
 * a summarization call, and the agent can rerun a tool when it needs the output again. The most
 * recent results stay intact. Clearing is used only when it alone brings the context well under the
 * threshold; otherwise the regular summary runs on the untouched history.
 */

import type { ProjectedSessionEntry, SessionProjection } from "../session-manager.ts";
import { estimateTokens } from "./compaction.ts";

export const CLEARED_TOOL_RESULT_PREFIX = "[Tool result cleared to save context";

export interface ClearToolResultsSettings {
	enabled: boolean;
	/** Most recent tool results that are never cleared. */
	keep: number;
	/** Results smaller than this are left alone. */
	minResultTokens: number;
	/** Tools whose results are never cleared. */
	excludeTools: string[];
	/** Clearing must bring the context to this share of the threshold or below. */
	targetRatio: number;
}

export const DEFAULT_CLEAR_TOOL_RESULTS_SETTINGS: ClearToolResultsSettings = {
	enabled: true,
	keep: 3,
	minResultTokens: 500,
	excludeTools: [],
	targetRatio: 0.85,
};

export interface ToolResultClearTarget {
	entryId: string;
	toolName: string;
	tokens: number;
	placeholder: string;
}

export interface ToolResultClearPlan {
	targets: ToolResultClearTarget[];
	/** Estimated context tokens once the targets are replaced. */
	tokensAfter: number;
}

function isCleared(entry: ProjectedSessionEntry): boolean {
	const message = entry.messages[0];
	if (message?.role !== "toolResult") return false;
	const first = message.content[0];
	return first?.type === "text" && first.text.startsWith(CLEARED_TOOL_RESULT_PREFIX);
}

export function clearedToolResultText(toolName: string, tokens: number): string {
	return `${CLEARED_TOOL_RESULT_PREFIX}: ${toolName} output, about ${tokens} tokens. Run the tool again if you need it.]`;
}

/**
 * Chooses the tool results to clear. Returns undefined when clearing would not bring the context to
 * `targetRatio` of the threshold, so the caller falls back to a summary.
 */
export function planToolResultClearing(
	projection: SessionProjection,
	contextTokens: number,
	thresholdTokens: number,
	settings: ClearToolResultsSettings,
): ToolResultClearPlan | undefined {
	if (!settings.enabled || thresholdTokens <= 0) return undefined;
	const results = projection.entries.filter(
		(entry) =>
			entry.sourceEntry.type === "message" &&
			entry.sourceEntry.message.role === "toolResult" &&
			entry.messages.length === 1 &&
			!isCleared(entry),
	);
	const candidates = results.slice(0, Math.max(0, results.length - settings.keep));
	const exclude = new Set(settings.excludeTools);
	const targets: ToolResultClearTarget[] = [];
	let tokensAfter = contextTokens;
	for (const entry of candidates) {
		const message = entry.messages[0];
		if (message?.role !== "toolResult" || exclude.has(message.toolName)) continue;
		const tokens = estimateTokens(message);
		if (tokens < settings.minResultTokens) continue;
		const placeholder = clearedToolResultText(message.toolName, tokens);
		tokensAfter -= tokens - Math.ceil(placeholder.length / 4);
		targets.push({ entryId: entry.sourceEntry.id, toolName: message.toolName, tokens, placeholder });
	}
	if (targets.length === 0 || tokensAfter > thresholdTokens * settings.targetRatio) return undefined;
	return { targets, tokensAfter };
}
