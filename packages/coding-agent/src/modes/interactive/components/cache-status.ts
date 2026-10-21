import type { PromptCacheTouch } from "../../../core/cache-warmer.ts";
import { theme } from "../theme/theme.ts";

/** Token counts of the latest request's prompt, as reported by the provider. */
export interface CachePromptUsage {
	/** Uncached prompt tokens. */
	input: number;
	cacheRead: number;
	cacheWrite: number;
}

/** Share of the prompt served from cache: cacheRead / (cacheRead + cacheWrite + input). */
export function getCacheHitPercent(usage: CachePromptUsage): number {
	const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
	return prompt > 0 ? (usage.cacheRead / prompt) * 100 : 0;
}

/** Formats remaining time as `4:59` or `1:02:03`. */
export function formatCountdown(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = String(total % 60).padStart(2, "0");
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

export interface CacheStatusLine {
	text: string;
	/** True while the expiry countdown is running, so the caller knows to re-render every second. */
	live: boolean;
}

/**
 * Compact prompt-cache status for the footer line, e.g. `100% cache 59:58` while warm or `100% cache cold` after expiry.
 * The countdown runs from the latest request or warming refresh to the end of the provider's cache lifetime.
 */
export function renderCacheStatusLine(
	usage: CachePromptUsage,
	touch: PromptCacheTouch | undefined,
	now: number,
): CacheStatusLine {
	const text = `${Math.round(getCacheHitPercent(usage))}% cache`;
	if (touch?.ttlMs === undefined) return { text, live: false };
	const remaining = touch.touchedAt + touch.ttlMs - now;
	if (remaining > 0) return { text: `${text} ${formatCountdown(remaining)}`, live: true };
	return { text: `${text} ${theme.fg("warning", "cold")}`, live: false };
}
