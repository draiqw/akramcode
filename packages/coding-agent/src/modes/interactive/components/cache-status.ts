import type { PromptCacheTouch } from "../../../core/cache-warmer.ts";
import { theme } from "../theme/theme.ts";

/** Cells used by the cache-hit bar. */
const CACHE_BAR_CELLS = 10;

/**
 * Renders a share as a fixed-width bar, e.g. `███░░░░░░░` for 30%.
 * Any share above zero shows at least one filled cell so it is distinguishable from zero.
 */
export function renderShareBar(percent: number, cells: number): string {
	const clamped = Math.min(100, Math.max(0, percent));
	let filled = Math.round((clamped / 100) * cells);
	if (clamped > 0 && filled === 0) filled = 1;
	return "█".repeat(filled) + "░".repeat(cells - filled);
}

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

/** Formats a cache lifetime compactly: `5m`, `1h`, `90s`, `1h30m`. */
export function formatCacheTtl(ttlMs: number): string {
	const seconds = Math.round(ttlMs / 1000);
	if (seconds < 60 || seconds % 60 !== 0) return `${seconds}s`;
	const minutes = seconds / 60;
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	return minutes % 60 === 0 ? `${hours}h` : `${hours}h${minutes % 60}m`;
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
 * One-line prompt-cache status, e.g.
 * `cache ██████████ 100%  read 390k  wrote 69  new 2  ttl 59:58/1h · warm: keep going`.
 * The countdown runs from the latest request or warming refresh to the end of the provider's cache lifetime.
 */
export function renderCacheStatusLine(
	usage: CachePromptUsage,
	touch: PromptCacheTouch | undefined,
	now: number,
	formatTokens: (count: number) => string,
): CacheStatusLine {
	const percent = getCacheHitPercent(usage);
	const parts = [
		`${theme.fg("accent", "cache")} ${theme.fg("success", renderShareBar(percent, CACHE_BAR_CELLS))} ${Math.round(percent)}%`,
		theme.fg("success", `read ${formatTokens(usage.cacheRead)}`),
		theme.fg("warning", `wrote ${formatTokens(usage.cacheWrite)}`),
		theme.fg("accent", `new ${formatTokens(usage.input)}`),
	];
	let live = false;
	if (touch?.ttlMs !== undefined) {
		const remaining = touch.touchedAt + touch.ttlMs - now;
		const ttl = formatCacheTtl(touch.ttlMs);
		if (remaining > 0) {
			live = true;
			parts.push(
				`${theme.fg("success", `ttl ${formatCountdown(remaining)}/${ttl}`)} ${theme.fg("muted", "· warm: keep going")}`,
			);
		} else {
			parts.push(
				`${theme.fg("muted", `ttl 0:00/${ttl}`)} ${theme.fg("warning", "· cold: next request rewrites the cache")}`,
			);
		}
	}
	return { text: parts.join("  "), live };
}
