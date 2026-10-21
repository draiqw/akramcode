import { type Component, truncateToWidth, visibleWidth } from "@akramcode/tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import { areExperimentalFeaturesEnabled } from "../../../core/experimental.ts";
import type { ContextUsage } from "../../../core/extensions/types.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { theme } from "../theme/theme.ts";
import { type CachePromptUsage, renderCacheStatusLine } from "./cache-status.ts";

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Format token counts for compact footer display.
 */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/** Formats generation speed, e.g. `48.3 tok/s` or `120 tok/s`. */
export function formatTokensPerSecond(tokensPerSecond: number): string {
	return tokensPerSecond >= 100 ? `${Math.round(tokensPerSecond)} tok/s` : `${tokensPerSecond.toFixed(1)} tok/s`;
}

interface SessionStats {
	session: AgentSession;
	sessionId: string;
	leafId: string | null;
	entryCount: number;
	limitsModel: unknown;
	/** Prompt usage of the latest assistant response, for the cache status line. */
	latestPromptUsage: CachePromptUsage | undefined;
	contextUsage: ContextUsage | undefined;
}

/**
 * Footer component that shows context usage, cache status, and the model.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
	private showCacheStatus = false;
	private cacheCountdownLive = false;
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;
	private sessionStats?: SessionStats;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider) {
		this.session = session;
		this.footerData = footerData;
	}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	/** Show the prompt-cache status line (hit ratio, cached tokens, expiry countdown). */
	setShowCacheStatus(enabled: boolean): void {
		this.showCacheStatus = enabled;
	}

	/** True when the last render showed a running cache countdown, so the footer should be re-rendered each second. */
	hasLiveCacheCountdown(): boolean {
		return this.cacheCountdownLive;
	}

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	/**
	 * The latest prompt usage and context usage scan the whole session, and the footer renders on every frame.
	 * Entries are append-only and every append moves the leaf, so the results only change with the
	 * session, leaf, entry count, or the model whose context window applies.
	 */
	private getSessionStats(): SessionStats {
		const sessionManager = this.session.sessionManager;
		const entryCount = sessionManager.getEntryCount();
		const sessionId = sessionManager.getSessionId();
		const leafId = sessionManager.getLeafId();
		const limitsModel = this.session.routedModel?.model ?? this.session.model;
		const cached = this.sessionStats;
		if (
			cached &&
			cached.session === this.session &&
			cached.sessionId === sessionId &&
			cached.leafId === leafId &&
			cached.entryCount === entryCount &&
			cached.limitsModel === limitsModel
		) {
			return cached;
		}

		let latestPromptUsage: CachePromptUsage | undefined;
		for (const entry of sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				const { input, cacheRead, cacheWrite } = entry.message.usage;
				latestPromptUsage = { input, cacheRead, cacheWrite };
			}
		}

		// Calculate context usage from session (handles compaction correctly).
		// After compaction, tokens are unknown until the next LLM response.
		const contextUsage = this.session.getContextUsage();
		this.sessionStats = {
			session: this.session,
			sessionId,
			leafId,
			entryCount,
			limitsModel,
			latestPromptUsage,
			contextUsage,
		};
		return this.sessionStats;
	}

	render(width: number): string[] {
		const state = this.session.state;
		const { latestPromptUsage, contextUsage } = this.getSessionStats();
		const cacheLine =
			this.showCacheStatus &&
			latestPromptUsage !== undefined &&
			latestPromptUsage.cacheRead + latestPromptUsage.cacheWrite > 0
				? renderCacheStatusLine(latestPromptUsage, this.session.promptCacheTouch, Date.now())
				: undefined;
		this.cacheCountdownLive = cacheLine?.live ?? false;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

		// The working directory and git branch are left out; a session name, when set, leads the line.
		const sessionName = this.session.sessionManager.getSessionName();

		// Build stats line, e.g. "2.7% context · 96% cache". Token totals and cost are in /usage.
		const statsParts = [];

		// Colorize context percentage based on usage
		const contextPercentDisplay = `${contextPercent}% context`;
		if (contextPercentValue > 90) {
			statsParts.push(theme.fg("error", contextPercentDisplay));
		} else if (contextPercentValue > 70) {
			statsParts.push(theme.fg("warning", contextPercentDisplay));
		} else {
			statsParts.push(contextPercentDisplay);
		}

		if (cacheLine) statsParts.push(cacheLine.text);

		let statsLeft = statsParts.join(theme.fg("dim", " · "));
		if (areExperimentalFeaturesEnabled()) {
			statsLeft += ` ${theme.fg("dim", "•")} ${theme.bold(theme.fg("warning", "xp"))}`;
		}
		if (sessionName) statsLeft = `${sessionName}  ${statsLeft}`;

		// Add model name on the right side, plus thinking level if model supports it
		const modelName = state.model?.id || "no-model";

		let statsLeftWidth = visibleWidth(statsLeft);

		// If statsLeft is too wide, truncate it
		if (statsLeftWidth > width) {
			statsLeft = truncateToWidth(statsLeft, width, "...");
			statsLeftWidth = visibleWidth(statsLeft);
		}

		// Calculate available space for padding (minimum 2 spaces between stats and model)
		const minPadding = 2;

		// Add thinking level indicator if model supports reasoning
		let rightSideWithoutProvider = modelName;
		if (state.model?.reasoning) {
			const thinkingLevel = state.thinkingLevel || "off";
			rightSideWithoutProvider =
				thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
		}
		// Kimi Coding is subscription-backed despite using API-key authentication.
		const usingSubscription = state.model
			? state.model.provider === "kimi-coding" || this.session.modelRuntime.isUsingSubscription(state.model.provider)
			: false;
		if (usingSubscription) rightSideWithoutProvider += " (sub)";
		// A virtual model routes each request; show where the latest response went.
		const routed = this.session.routedModel;
		if (routed) {
			const level = routed.thinkingLevel ? ` • ${routed.thinkingLevel}` : "";
			rightSideWithoutProvider += ` → ${routed.model.id}${level}`;
		}

		// Prepend the provider in parentheses if there are multiple providers and there's enough room
		let rightSide = rightSideWithoutProvider;
		if (this.footerData.getAvailableProviderCount() > 1 && state.model) {
			rightSide = `(${state.model!.provider}) ${rightSideWithoutProvider}`;
			if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width) {
				// Too wide, fall back
				rightSide = rightSideWithoutProvider;
			}
		}

		const rightSideWidth = visibleWidth(rightSide);
		const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

		let statsLine: string;
		if (totalNeeded <= width) {
			// Both fit - add padding to right-align model
			const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
			statsLine = statsLeft + padding + rightSide;
		} else {
			// Need to truncate right side
			const availableForRight = width - statsLeftWidth - minPadding;
			if (availableForRight > 0) {
				const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
				const truncatedRightWidth = visibleWidth(truncatedRight);
				const padding = " ".repeat(Math.max(0, width - statsLeftWidth - truncatedRightWidth));
				statsLine = statsLeft + padding + truncatedRight;
			} else {
				// Not enough space for right side at all
				statsLine = statsLeft;
			}
		}

		// Apply dim to each part separately. statsLeft may contain color codes (for context %)
		// that end with a reset, which would clear an outer dim wrapper. So we dim the parts
		// before and after the colored section independently.
		const dimStatsLeft = theme.fg("dim", statsLeft);
		const remainder = statsLine.slice(statsLeft.length); // padding + rightSide
		const dimRemainder = theme.fg("dim", remainder);

		const lines = [dimStatsLeft + dimRemainder];

		// Add extension statuses on a single line, sorted by key alphabetically
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
