/**
 * Read-only index of session JSONL files for `akramcode traces`. Discovers sessions under the
 * configured roots (including subagent transcripts in `<session>.subagents/`), parses each file
 * as a stream, and caches results by size and mtime so a refresh only re-reads changed files.
 */

import { createHash } from "node:crypto";
import { createReadStream, type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
	SessionAnalyzer,
	type TraceEvent,
	type TraceFileMeta,
	type TraceSessionListItem,
	type TraceSessionSummary,
	toListItem,
} from "./analyze.ts";

const SUBAGENT_DIR_SUFFIX = ".subagents";
/** `sessions/<project>/<session>.subagents/<child>.jsonl` is depth 2; leave room for custom layouts. */
const MAX_SCAN_DEPTH = 4;
const PARSE_CONCURRENCY = 8;
const DETAIL_CACHE_SIZE = 16;

export interface TraceDetail {
	summary: TraceSessionSummary;
	events: TraceEvent[];
}

interface CachedFile {
	sizeBytes: number;
	mtimeMs: number;
	/** Undefined when the file is not a session (no valid header). */
	summary: TraceSessionSummary | undefined;
}

interface Candidate {
	path: string;
	sizeBytes: number;
	mtimeMs: number;
}

export function traceKeyForPath(path: string): string {
	return createHash("sha1").update(path).digest("hex").slice(0, 16);
}

function isSubagentTranscript(path: string): boolean {
	return basename(dirname(path)).endsWith(SUBAGENT_DIR_SUFFIX);
}

/** `<dir>/<parent>.subagents/<child>.jsonl` -> `<dir>/<parent>.jsonl`. */
function subagentParentPath(path: string): string {
	const dir = dirname(path);
	return join(dirname(dir), `${basename(dir).slice(0, -SUBAGENT_DIR_SUFFIX.length)}.jsonl`);
}

/**
 * Stream a session file line by line. Malformed lines are counted and skipped, like the session
 * loader does. Returns false when the first parsed line is not a session header.
 */
export async function readSessionLines(
	path: string,
	onHeader: (entry: unknown) => boolean,
	onEntry: (entry: unknown) => void,
): Promise<{ isSession: boolean; malformedLines: number }> {
	const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
	let malformedLines = 0;
	let headerSeen = false;
	try {
		for await (const line of lines) {
			if (!line.trim()) continue;
			let entry: unknown;
			try {
				entry = JSON.parse(line);
			} catch {
				malformedLines++;
				continue;
			}
			if (!headerSeen) {
				if (!onHeader(entry)) return { isSession: false, malformedLines };
				headerSeen = true;
				continue;
			}
			onEntry(entry);
		}
	} finally {
		lines.close();
	}
	return { isSession: headerSeen, malformedLines };
}

async function analyzeFile(
	candidate: Candidate,
	options: { timeline: boolean },
): Promise<{ summary: TraceSessionSummary; events: TraceEvent[] } | undefined> {
	const meta: TraceFileMeta = {
		key: traceKeyForPath(candidate.path),
		path: candidate.path,
		sizeBytes: candidate.sizeBytes,
		mtimeMs: candidate.mtimeMs,
		malformedLines: 0,
		isSubagent: isSubagentTranscript(candidate.path),
	};
	const analyzer = new SessionAnalyzer(meta, options);
	const result = await readSessionLines(
		candidate.path,
		(entry) => analyzer.setHeader(entry),
		(entry) => analyzer.add(entry),
	);
	if (!result.isSession) return undefined;
	meta.malformedLines = result.malformedLines;
	return analyzer.finish();
}

async function mapConcurrent<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const item = items[next++];
			await run(item);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export interface TraceStoreOptions {
	/** Directories to scan for session files. Missing directories are skipped. */
	roots: readonly string[];
}

export class TraceStore {
	readonly roots: readonly string[];
	private files = new Map<string, CachedFile>();
	private keyToPath = new Map<string, string>();
	private basenameToPath = new Map<string, string>();
	private sessionIdToKey = new Map<string, string>();
	private sorted: TraceSessionSummary[] = [];
	private readonly detailCache = new Map<string, { sizeBytes: number; mtimeMs: number; detail: TraceDetail }>();
	private refreshing: Promise<boolean> | undefined;
	private refreshedOnce = false;
	/** Increments whenever a refresh finds added, changed, or removed sessions. */
	version = 0;

	constructor(options: TraceStoreOptions) {
		this.roots = [...new Set(options.roots.map((root) => resolve(root)))];
	}

	/** Re-scan the roots. Concurrent calls share one scan. Returns true if anything changed. */
	refresh(): Promise<boolean> {
		this.refreshing ??= this.doRefresh().finally(() => {
			this.refreshing = undefined;
		});
		return this.refreshing;
	}

	/** Resolve once the first scan finished. */
	async ready(): Promise<void> {
		if (!this.refreshedOnce) await this.refresh();
	}

	private async collect(dir: string, depth: number, out: Map<string, Candidate>): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				try {
					const stats = await stat(path);
					out.set(path, { path, sizeBytes: stats.size, mtimeMs: stats.mtimeMs });
				} catch {
					// Deleted between readdir and stat.
				}
			} else if ((entry.isDirectory() || entry.isSymbolicLink()) && depth < MAX_SCAN_DEPTH) {
				await this.collect(path, depth + 1, out);
			}
		}
	}

	private async doRefresh(): Promise<boolean> {
		const candidates = new Map<string, Candidate>();
		for (const root of this.roots) await this.collect(root, 0, candidates);

		let changed = false;
		const next = new Map<string, CachedFile>();
		const toParse: Candidate[] = [];
		for (const candidate of candidates.values()) {
			const cached = this.files.get(candidate.path);
			if (cached && cached.sizeBytes === candidate.sizeBytes && cached.mtimeMs === candidate.mtimeMs) {
				next.set(candidate.path, cached);
			} else {
				toParse.push(candidate);
			}
		}
		for (const path of this.files.keys()) {
			if (!candidates.has(path)) changed = true;
		}
		await mapConcurrent(toParse, PARSE_CONCURRENCY, async (candidate) => {
			let summary: TraceSessionSummary | undefined;
			try {
				summary = (await analyzeFile(candidate, { timeline: false }))?.summary;
			} catch {
				summary = undefined;
			}
			next.set(candidate.path, { sizeBytes: candidate.sizeBytes, mtimeMs: candidate.mtimeMs, summary });
			changed = true;
		});

		this.files = next;
		this.refreshedOnce = true;
		if (changed || this.version === 0) {
			this.reindex();
			this.version++;
		}
		return changed;
	}

	/** Rebuild key lookups and parent/child links. */
	private reindex(): void {
		this.keyToPath = new Map();
		this.basenameToPath = new Map();
		this.sessionIdToKey = new Map();
		const summaries: TraceSessionSummary[] = [];
		for (const [path, file] of this.files) {
			if (!file.summary) continue;
			this.keyToPath.set(file.summary.key, path);
			this.basenameToPath.set(basename(path), path);
			if (!this.sessionIdToKey.has(file.summary.sessionId))
				this.sessionIdToKey.set(file.summary.sessionId, file.summary.key);
			summaries.push(file.summary);
		}
		for (const summary of summaries) summary.childKeys = [];
		for (const summary of summaries) {
			if (summary.isSubagent) {
				const parent = this.files.get(subagentParentPath(summary.path))?.summary;
				summary.parentKey = parent?.key;
				parent?.childKeys.push(summary.key);
			}
			summary.forkParentKey = summary.forkParentPath ? this.keyForPath(summary.forkParentPath) : undefined;
		}
		for (const summary of summaries) {
			summary.childKeys.sort((a, b) => (this.getSummary(a)?.startedAt ?? 0) - (this.getSummary(b)?.startedAt ?? 0));
		}
		this.sorted = summaries.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	}

	/**
	 * Key of an indexed session file. Paths recorded in sessions may differ from scanned ones by
	 * symlinks (for example `/var` and `/private/var` on macOS), so fall back to the file name,
	 * which embeds the session id.
	 */
	keyForPath(path: string): string | undefined {
		const exact = this.files.get(resolve(path))?.summary;
		if (exact) return exact.key;
		const byName = this.basenameToPath.get(basename(path));
		return byName ? this.files.get(byName)?.summary?.key : undefined;
	}

	keyForSessionId(sessionId: string): string | undefined {
		return this.sessionIdToKey.get(sessionId);
	}

	getSummaries(): readonly TraceSessionSummary[] {
		return this.sorted;
	}

	getSummary(key: string): TraceSessionSummary | undefined {
		const path = this.keyToPath.get(key);
		return path ? this.files.get(path)?.summary : undefined;
	}

	getListItem(key: string): TraceSessionListItem | undefined {
		const summary = this.getSummary(key);
		return summary ? toListItem(summary) : undefined;
	}

	getPath(key: string): string | undefined {
		return this.keyToPath.get(key);
	}

	/** Full timeline of a session, parsed on demand and cached by size and mtime. */
	async getDetail(key: string): Promise<TraceDetail | undefined> {
		const path = this.keyToPath.get(key);
		if (!path) return undefined;
		let stats: { size: number; mtimeMs: number };
		try {
			stats = await stat(path);
		} catch {
			return undefined;
		}
		const cached = this.detailCache.get(key);
		if (cached && cached.sizeBytes === stats.size && cached.mtimeMs === stats.mtimeMs) {
			this.detailCache.delete(key);
			this.detailCache.set(key, cached);
			return cached.detail;
		}
		const analyzed = await analyzeFile({ path, sizeBytes: stats.size, mtimeMs: stats.mtimeMs }, { timeline: true });
		if (!analyzed) return undefined;
		const indexed = this.getSummary(key);
		analyzed.summary.childKeys = indexed?.childKeys ?? [];
		analyzed.summary.parentKey = indexed?.parentKey;
		analyzed.summary.forkParentKey = indexed?.forkParentKey;
		for (const event of analyzed.events) {
			if (event.childPath) event.childKey = this.keyForPath(event.childPath);
		}
		const detail = { summary: analyzed.summary, events: analyzed.events };
		this.detailCache.set(key, { sizeBytes: stats.size, mtimeMs: stats.mtimeMs, detail });
		while (this.detailCache.size > DETAIL_CACHE_SIZE) {
			const oldest = this.detailCache.keys().next().value;
			if (oldest === undefined) break;
			this.detailCache.delete(oldest);
		}
		return detail;
	}

	/** Raw parsed entries (header first), for JSON export. Malformed lines are skipped. */
	async readEntries(key: string): Promise<unknown[] | undefined> {
		const path = this.keyToPath.get(key);
		if (!path) return undefined;
		const entries: unknown[] = [];
		try {
			const result = await readSessionLines(
				path,
				(entry) => {
					entries.push(entry);
					return true;
				},
				(entry) => entries.push(entry),
			);
			return result.isSession ? entries : undefined;
		} catch {
			return undefined;
		}
	}
}
