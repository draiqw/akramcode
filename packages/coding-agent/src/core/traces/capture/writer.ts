/**
 * Append-only writer for capture files and retention of the capture directory. Writes are
 * synchronous on purpose: records are written when a request or tool finishes, and print mode
 * exits right after the last response, so buffered asynchronous writes would be lost.
 */

import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { readdir, rm, rmdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type BodyRef, type CaptureRecord, INLINE_BODY_LIMIT } from "./format.ts";

export function sha1(text: string): string {
	return createHash("sha1").update(text).digest("hex");
}

/**
 * Cut `text` to at most `maxBytes` UTF-8 bytes. A token-like run of characters at the cut is
 * dropped as well, so the visible prefix of a secret split by the cut is not kept unredacted.
 */
export function capText(text: string, maxBytes: number): { text: string; truncated: boolean } {
	if (text.length <= maxBytes / 4 || Buffer.byteLength(text) <= maxBytes) return { text, truncated: false };
	// At most 4 bytes per character: slicing characters first bounds the copy below.
	const buffer = Buffer.from(text.slice(0, maxBytes));
	let end = Math.min(maxBytes, buffer.length);
	// Back up to a character boundary instead of leaving a broken multi-byte sequence.
	while (end > 0 && end < buffer.length && (buffer[end] & 0xc0) === 0x80) end--;
	const prefix = buffer.subarray(0, end).toString("utf8");
	return { text: prefix.replace(/[A-Za-z0-9_\-+/=.~]{8,}$/, ""), truncated: true };
}

/**
 * Bytes buffered across all in-flight captures (request and response bodies, WebSocket frames,
 * stream events). Past the limit, captures keep metadata only, so many concurrent large requests
 * cannot exhaust memory.
 */
export class MemoryBudget {
	readonly limit: number;
	used = 0;

	constructor(limit: number) {
		this.limit = limit;
	}

	tryReserve(bytes: number): boolean {
		if (this.used + bytes > this.limit) return false;
		this.used += bytes;
		return true;
	}

	release(bytes: number): void {
		this.used = Math.max(0, this.used - bytes);
	}
}

function makePrivateDir(dir: string): void {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	// mkdir's mode is reduced by the umask and ignored for existing directories.
	chmodSync(dir, 0o700);
}

export class CaptureFile {
	readonly path: string;
	private readonly blobDir: string;
	private readonly maxBodyBytes: number;
	private dirReady = false;
	private blobDirReady = false;
	private failed = false;

	constructor(path: string, options: { maxBodyBytes?: number; rootDir?: string } = {}) {
		this.path = path;
		this.blobDir = `${path.slice(0, -".jsonl".length)}.blobs`;
		this.maxBodyBytes = options.maxBodyBytes ?? Number.POSITIVE_INFINITY;
		this.rootDir = options.rootDir;
	}

	private readonly rootDir: string | undefined;

	append(record: CaptureRecord): void {
		if (this.failed) return;
		try {
			if (!this.dirReady) {
				if (this.rootDir) makePrivateDir(this.rootDir);
				makePrivateDir(dirname(dirname(this.path)));
				makePrivateDir(dirname(this.path));
				this.dirReady = true;
			}
			appendFileSync(this.path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
		} catch {
			// Capture is diagnostics; a full disk or a permission problem must not break the agent.
			this.failed = true;
		}
	}

	/** Store a body inline or as a blob, and return its reference. */
	body(name: string, input: string, extra: Partial<BodyRef> = {}): BodyRef {
		const capped = capText(input, this.maxBodyBytes);
		const text = capped.text;
		const bytes = Buffer.byteLength(text);
		const ref: BodyRef = { bytes, sha1: sha1(text), ...extra, ...(capped.truncated ? { truncated: true } : {}) };
		if (bytes <= INLINE_BODY_LIMIT) {
			ref.text = text;
			return ref;
		}
		const blob = `${name.replace(/[^A-Za-z0-9._-]/g, "_")}.txt`;
		try {
			if (!this.blobDirReady) {
				makePrivateDir(this.blobDir);
				this.blobDirReady = true;
			}
			// "wx": never write through a file or link that already exists.
			writeFileSync(join(this.blobDir, blob), text, { mode: 0o600, flag: "wx" });
			ref.blob = blob;
		} catch {
			ref.text = text.slice(0, INLINE_BODY_LIMIT);
			ref.truncated = true;
		}
		return ref;
	}
}

export interface RetentionOptions {
	maxTotalBytes: number;
	maxAgeMs: number;
	/** Trace files this process is writing; never deleted. */
	protect?: ReadonlySet<string>;
	now?: number;
}

interface TraceFileUsage {
	path: string;
	blobDir: string;
	mtimeMs: number;
	bytes: number;
}

async function directorySize(dir: string): Promise<number> {
	let total = 0;
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return 0;
	}
	for (const name of entries) {
		try {
			total += (await stat(join(dir, name))).size;
		} catch {
			// Removed concurrently.
		}
	}
	return total;
}

async function collectTraceFiles(dir: string, depth: number, out: TraceFileUsage[]): Promise<void> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return;
	}
	for (const name of names) {
		const path = join(dir, name);
		if (name.endsWith(".jsonl")) {
			try {
				const stats = await stat(path);
				const blobDir = `${path.slice(0, -".jsonl".length)}.blobs`;
				out.push({ path, blobDir, mtimeMs: stats.mtimeMs, bytes: stats.size + (await directorySize(blobDir)) });
			} catch {
				// Removed concurrently.
			}
		} else if (!name.endsWith(".blobs") && depth < 3) {
			try {
				if ((await stat(path)).isDirectory()) await collectTraceFiles(path, depth + 1, out);
			} catch {
				// Removed concurrently.
			}
		}
	}
}

/**
 * Delete trace files (with their blobs) older than `maxAgeMs`, then the oldest ones until the
 * directory fits `maxTotalBytes`. Returns the number of deleted trace files.
 */
export async function enforceCaptureRetention(dir: string, options: RetentionOptions): Promise<number> {
	const files: TraceFileUsage[] = [];
	await collectTraceFiles(dir, 0, files);
	const now = options.now ?? Date.now();
	const protect = options.protect ?? new Set<string>();
	files.sort((a, b) => a.mtimeMs - b.mtimeMs);
	let total = files.reduce((sum, file) => sum + file.bytes, 0);
	let deleted = 0;
	for (const file of files) {
		if (protect.has(file.path)) continue;
		const expired = now - file.mtimeMs > options.maxAgeMs;
		if (!expired && total <= options.maxTotalBytes) continue;
		try {
			await rm(file.blobDir, { recursive: true, force: true });
			await rm(file.path, { force: true });
			total -= file.bytes;
			deleted++;
			// Remove the per-session directory once it is empty.
			if (basename(dirname(dirname(file.path))) === "sessions") await rmdir(dirname(file.path)).catch(() => {});
		} catch {
			// Try the next file.
		}
	}
	return deleted;
}
