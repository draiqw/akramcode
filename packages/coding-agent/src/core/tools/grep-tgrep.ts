import { execFile } from "node:child_process";
import { accessSync, constants, lstatSync, readFileSync, realpathSync, type Stats, statSync } from "node:fs";
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

/** Reuse a verified server for this long before probing it again with git and lsof. */
const VERIFIED_SERVER_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 2_000;

export interface ProbeResult {
	status: number | null;
	stdout: string;
	stderr: string;
}

/** System access used to verify a tgrep server. Tests replace it. */
export interface TgrepServerProbe {
	getuid(): number;
	/** Run a command. Resolves undefined when it cannot be started or times out. */
	run(command: string, args: string[], cwd?: string): Promise<ProbeResult | undefined>;
}

const defaultProbe: TgrepServerProbe = {
	getuid: () => process.getuid?.() ?? -1,
	run: (command, args, cwd) =>
		new Promise((resolve) => {
			execFile(
				command,
				args,
				{ cwd, timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, encoding: "utf-8" },
				(error, stdout, stderr) => {
					if (error && typeof error.code !== "number") {
						resolve(undefined);
						return;
					}
					resolve({ status: error ? (error.code as number) : 0, stdout, stderr });
				},
			);
		}),
};

export interface TgrepServer {
	/** The `.tgrep` directory of the server. */
	indexDir: string;
	/** Real path of the tgrep executable that runs the server and is used for the search. */
	binary: string;
}

const verifiedServers = new Map<string, number>();

function realpathOrUndefined(p: string): string | undefined {
	try {
		return realpathSync(p);
	} catch {
		return undefined;
	}
}

/** Real path of `command`, looked up on PATH when it has no directory part. */
export function resolveExecutable(command: string): string | undefined {
	const candidates = command.includes("/")
		? [path.resolve(command)]
		: (process.env.PATH ?? "")
				.split(path.delimiter)
				.filter(Boolean)
				.map((dir) => path.join(dir, command));
	for (const candidate of candidates) {
		try {
			accessSync(candidate, constants.X_OK);
			if (!statSync(candidate).isFile()) continue;
			return realpathSync(candidate);
		} catch {
			// Not here: try the next PATH entry.
		}
	}
	return undefined;
}

/** Owned by the current user, not a symlink, and not writable by group or others. */
function isPrivate(stats: Stats, uid: number): boolean {
	return !stats.isSymbolicLink() && stats.uid === uid && (stats.mode & 0o022) === 0;
}

interface LsofFile {
	fd?: string;
	type?: string;
	name?: string;
	tcp: string[];
}

function parseLsof(output: string): { uid?: number; files: LsofFile[] } {
	let uid: number | undefined;
	const files: LsofFile[] = [];
	let current: LsofFile | undefined;
	for (const line of output.split("\n")) {
		const field = line[0];
		const value = line.slice(1);
		if (field === "u") uid = Number(value);
		else if (field === "f") {
			current = { fd: value, tcp: [] };
			files.push(current);
		} else if (current && field === "t") current.type = value;
		else if (current && field === "n") current.name = value;
		else if (current && field === "T") current.tcp.push(value);
	}
	return { uid, files };
}

/** Whether git tracks the discovery file, which would mean the repository shipped it. */
async function isTrackedByGit(root: string, probe: TgrepServerProbe): Promise<boolean> {
	const result = await probe.run("git", ["ls-files", "--", `${TGREP_INDEX_DIR}/serve.json`], root);
	if (!result) return true;
	if (result.status === 0) return result.stdout.trim() !== "";
	return !/not a git repository/i.test(result.stderr);
}

/**
 * Whether `pid` is a process of the current user that runs `binary`, holds the server lock of
 * `indexDir`, and listens on `port` on a loopback address. Uses lsof.
 */
async function isServerProcess(
	pid: number,
	port: number,
	indexDir: string,
	binary: string,
	probe: TgrepServerProbe,
): Promise<boolean> {
	const result = await probe.run("lsof", ["-nP", "-p", String(pid), "-FftnTu"]);
	if (!result || result.status !== 0) return false;
	const { uid, files } = parseLsof(result.stdout);
	if (uid !== probe.getuid()) return false;
	const executable = files.find((file) => file.fd === "txt")?.name;
	if (!executable || realpathOrUndefined(executable) !== binary) return false;
	const lock = realpathOrUndefined(path.join(indexDir, "serve.lock"));
	if (!lock || !files.some((file) => file.name !== undefined && realpathOrUndefined(file.name) === lock)) {
		return false;
	}
	const loopback = new Set([`127.0.0.1:${port}`, `[::1]:${port}`]);
	return files.some(
		(file) =>
			(file.type === "IPv4" || file.type === "IPv6") &&
			file.name !== undefined &&
			loopback.has(file.name) &&
			file.tcp.includes("ST=LISTEN"),
	);
}

/**
 * Find a running `tgrep serve` that covers `searchPath` and can be trusted.
 *
 * The nearest `.tgrep/serve.json` in `searchPath` or a parent directory names the server. A
 * repository or another user could plant that file, so it is used only when:
 * - the indexed directory, `.tgrep` and `serve.json` are not symlinks and not writable by group or
 *   others, and `.tgrep` and `serve.json` belong to the current user;
 * - git does not track `serve.json`;
 * - the named process is alive, belongs to the current user, runs the configured tgrep executable,
 *   holds `.tgrep/serve.lock` open, and listens on the named port on 127.0.0.1 or ::1.
 * Returns undefined otherwise, so the caller searches with ripgrep.
 */
export async function findTgrepServer(
	searchPath: string,
	tgrepCommand: string,
	probe: TgrepServerProbe = defaultProbe,
): Promise<TgrepServer | undefined> {
	const binary = resolveExecutable(tgrepCommand);
	if (!binary) return undefined;

	let root = path.resolve(searchPath);
	let fileStats: Stats | undefined;
	while (true) {
		try {
			fileStats = lstatSync(path.join(root, TGREP_INDEX_DIR, "serve.json"));
			break;
		} catch {
			const parent = path.dirname(root);
			if (parent === root) return undefined;
			root = parent;
		}
	}
	const indexDir = path.join(root, TGREP_INDEX_DIR);
	const serveJson = path.join(indexDir, "serve.json");
	const uid = probe.getuid();
	let info: { pid?: unknown; port?: unknown };
	try {
		const rootStats = lstatSync(root);
		if (rootStats.isSymbolicLink() || (rootStats.mode & 0o022) !== 0) return undefined;
		if (!isPrivate(lstatSync(indexDir), uid) || !fileStats.isFile() || !isPrivate(fileStats, uid)) return undefined;
		info = JSON.parse(readFileSync(serveJson, "utf-8"));
	} catch {
		return undefined;
	}
	const { pid, port } = info;
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return undefined;
	if (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > 65535) return undefined;
	try {
		process.kill(pid, 0);
	} catch {
		// Gone, or EPERM: a process of another user.
		return undefined;
	}

	const key = [binary, indexDir, pid, port, fileStats.ino, fileStats.mtimeMs].join("\0");
	const verifiedAt = verifiedServers.get(key);
	if (verifiedAt !== undefined && Date.now() - verifiedAt < VERIFIED_SERVER_TTL_MS) return { indexDir, binary };
	verifiedServers.delete(key);

	if (await isTrackedByGit(root, probe)) return undefined;
	if (!(await isServerProcess(pid, port, indexDir, binary, probe))) return undefined;
	verifiedServers.set(key, Date.now());
	return { indexDir, binary };
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
