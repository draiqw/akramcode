import { readFileSync } from "node:fs";
import path from "node:path";

/** Name of the index directory `tgrep index` and `tgrep serve` create in the indexed root. */
const TGREP_INDEX_DIR = ".tgrep";

/** tgrep prints this on stderr with `--stats` only when the running server answered the query. */
export const TGREP_SERVER_MARKER = "(via server)";

/** A server that has not answered by then is treated as unusable and ripgrep runs instead. */
export const TGREP_TIMEOUT_MS = 5_000;

/**
 * tgrep cannot stop at the match limit: the server answer is only verified when the process
 * finishes. A query whose output keeps growing after the limit is broad, and ripgrep, which stops
 * at the limit, answers it faster. When the limit is reached and the output exceeds this many bytes,
 * ripgrep runs instead.
 */
export const TGREP_MAX_OUTPUT_BYTES_AFTER_LIMIT = 256 * 1024;

/**
 * Skip tgrep this long after a write or edit tool call finished. The server applies file
 * changes asynchronously; on macOS a new or changed file became searchable after about 40ms.
 */
export const TGREP_MUTATION_GRACE_MS = 2_000;

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM: the process exists but belongs to another user.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Find the index directory of a running `tgrep serve` that covers `searchPath`.
 * Walks up from `searchPath` to the nearest `.tgrep/serve.json` whose server process is alive.
 * Returns undefined when there is none, so the caller searches with ripgrep.
 */
export function findTgrepServerIndex(searchPath: string): string | undefined {
	let dir = path.resolve(searchPath);
	while (true) {
		const indexDir = path.join(dir, TGREP_INDEX_DIR);
		try {
			const info = JSON.parse(readFileSync(path.join(indexDir, "serve.json"), "utf-8")) as { pid?: unknown };
			if (typeof info.pid === "number" && Number.isInteger(info.pid) && info.pid > 0 && isProcessAlive(info.pid)) {
				return indexDir;
			}
		} catch {
			// No index here, or an unreadable discovery file: keep looking in the parent.
		}
		const parent = path.dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

export interface TgrepArgsInput {
	indexDir: string;
	pattern: string;
	searchPath: string;
	glob?: string;
	ignoreCase?: boolean;
	literal?: boolean;
	limit: number;
}

/**
 * Arguments for a tgrep search that mirrors the ripgrep invocation of the grep tool.
 * `--index-path` makes a search below the indexed root reach the server; tgrep otherwise looks
 * for `.tgrep` only in the search path itself. `--stats` reports whether the server answered.
 * `--max-count` bounds the output per file; it cannot change the first `limit` matches.
 */
export function buildTgrepArgs(input: TgrepArgsInput): string[] {
	const args = [
		"--json",
		"--line-number",
		"--color=never",
		"--hidden",
		"--stats",
		"--index-path",
		input.indexDir,
		"--max-count",
		String(input.limit),
	];
	if (input.ignoreCase) args.push("--ignore-case");
	if (input.literal) args.push("--fixed-strings");
	if (input.glob) args.push("--glob", input.glob);
	args.push("--", input.pattern, input.searchPath);
	return args;
}
