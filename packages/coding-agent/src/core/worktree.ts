/**
 * Session worktrees: before a session first changes code in a git checkout, it moves into its own
 * worktree at `<repo root>/.worktrees/<name>` on its own branch `<name>`, so sessions that run in the
 * same project at the same time do not change each other's files or branch.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

/** Directory under the repository root that holds session worktrees. */
export const WORKTREES_DIR = ".worktrees";
/** Custom session entry that records the worktree a session moved into. */
export const WORKTREE_ENTRY_TYPE = "worktree";

export interface RepoInfo {
	/** Top-level directory of the checkout, canonical. */
	root: string;
	/** Directory shared by all worktrees of the repository (`.git` of the main checkout). */
	commonDir: string;
	/** Whether the checkout is a linked worktree rather than the main checkout. */
	linked: boolean;
}

/** Data of a `worktree` custom entry. */
export interface WorktreeEntryData {
	sessionId: string;
	/** Root of the main checkout. */
	mainRoot: string;
	/** Root of the worktree. */
	path: string;
	branch: string;
	/** Commit the branch started from. */
	base: string;
	/** Uncommitted changes of the main checkout when the worktree was created; they are not carried over. */
	dirtyCount: number;
}

export interface SessionWorktree extends WorktreeEntryData {
	/** Directory the session works in: the worktree root, or the same subdirectory as before. */
	cwd: string;
}

/** Whether `data`, read from a session entry, is a {@link WorktreeEntryData}. */
export function isWorktreeEntryData(data: unknown): data is WorktreeEntryData {
	if (typeof data !== "object" || data === null) return false;
	const record = data as Record<string, unknown>;
	return (
		["sessionId", "mainRoot", "path", "branch", "base"].every((key) => typeof record[key] === "string") &&
		typeof record.dirtyCount === "number"
	);
}

/**
 * The `worktree` system prompt section: before the move, how the first change moves the session;
 * after it, where the session works.
 */
export function formatWorktreePromptSection(worktree: WorktreeEntryData | undefined): string {
	if (!worktree) {
		return "This git checkout is shared with other sessions. Your first change (edit, write, or a git command that changes the checkout) moves this session into its own worktree under .worktrees/ on a new branch. Change files with edit and write; do not switch branches in this checkout.";
	}
	return [
		`You work in your own git worktree ${worktree.path} on branch ${worktree.branch}, created from ${worktree.base.slice(0, 12)}.`,
		...(worktree.dirtyCount > 0
			? [
					`The main checkout had ${worktree.dirtyCount} uncommitted change${worktree.dirtyCount === 1 ? "" : "s"}; they are not in this worktree.`,
				]
			: []),
		`Ignored files such as node_modules are not copied; Node resolves packages from ${worktree.mainRoot}/node_modules.`,
		`Do not change files under ${worktree.mainRoot} outside ${WORKTREES_DIR}/. Paths there given to read, edit, write, grep, find, and ls are mapped to this worktree.`,
	].join("\n");
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trimEnd();
}

function gitSucceeds(cwd: string, args: string[]): boolean {
	try {
		execFileSync("git", args, { cwd, stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Canonical form of `path`, which may not exist yet: the real path of its nearest existing
 * ancestor with the rest appended. On macOS `/tmp` and `/var` are links into `/private`.
 */
export function canonicalPath(path: string): string {
	let existing = path;
	const rest: string[] = [];
	while (!existsSync(existing)) {
		const parent = dirname(existing);
		if (parent === existing) return path;
		rest.unshift(basename(existing));
		existing = parent;
	}
	try {
		return join(realpathSync(existing), ...rest);
	} catch {
		return path;
	}
}

function isWithin(path: string, dir: string): boolean {
	const rel = relative(dir, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The git checkout containing `cwd`, or undefined outside a repository. */
export function detectRepo(cwd: string): RepoInfo | undefined {
	try {
		const [root, gitDir, commonDir] = git(cwd, [
			"rev-parse",
			"--path-format=absolute",
			"--show-toplevel",
			"--git-dir",
			"--git-common-dir",
		]).split("\n");
		if (!root || !gitDir || !commonDir) return undefined;
		const canonicalRoot = canonicalPath(root);
		return {
			root: canonicalRoot,
			commonDir: canonicalPath(commonDir),
			linked: canonicalPath(gitDir) !== canonicalPath(commonDir) || canonicalRoot.split(sep).includes(WORKTREES_DIR),
		};
	} catch {
		return undefined;
	}
}

/** Local date as `YYYY-MM-DD`. */
export function formatWorktreeDate(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const CYRILLIC: Record<string, string> = {
	а: "a",
	б: "b",
	в: "v",
	г: "g",
	д: "d",
	е: "e",
	ё: "e",
	ж: "zh",
	з: "z",
	и: "i",
	й: "y",
	к: "k",
	л: "l",
	м: "m",
	н: "n",
	о: "o",
	п: "p",
	р: "r",
	с: "s",
	т: "t",
	у: "u",
	ф: "f",
	х: "kh",
	ц: "ts",
	ч: "ch",
	ш: "sh",
	щ: "shch",
	ъ: "",
	ы: "y",
	ь: "",
	э: "e",
	ю: "yu",
	я: "ya",
	і: "i",
	ї: "yi",
	є: "ye",
	ґ: "g",
};

const MAX_SLUG_LENGTH = 40;

/**
 * Kebab-case slug of `text`: Cyrillic transliterated, other characters outside `[a-z0-9]` dropped,
 * at most `maxWords` words and 40 characters. Empty when nothing is left.
 */
export function slugify(text: string, maxWords = Number.POSITIVE_INFINITY): string {
	const latin = [...text.toLowerCase()].map((char) => CYRILLIC[char] ?? char).join("");
	const words = latin
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(" ")
		.filter((word) => word.length > 0)
		.slice(0, maxWords);
	let slug = "";
	for (const word of words) {
		const next = slug ? `${slug}-${word}` : word;
		if (next.length > MAX_SLUG_LENGTH) {
			if (!slug) slug = word.slice(0, MAX_SLUG_LENGTH);
			break;
		}
		slug = next;
	}
	return slug;
}

/** Make sure `.worktrees/` is ignored, through the repository's `info/exclude` when it is not yet. */
function ensureIgnored(repo: RepoInfo): void {
	if (gitSucceeds(repo.root, ["check-ignore", "-q", `${WORKTREES_DIR}/`])) return;
	const infoDir = join(repo.commonDir, "info");
	mkdirSync(infoDir, { recursive: true });
	const excludePath = join(infoDir, "exclude");
	const current = existsSync(excludePath) ? readFileSync(excludePath, "utf-8") : "";
	appendFileSync(excludePath, `${current && !current.endsWith("\n") ? "\n" : ""}${WORKTREES_DIR}/\n`);
}

function branchExists(root: string, branch: string): boolean {
	return gitSucceeds(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
}

/** Same subdirectory of the worktree as `cwd` is of the main checkout, when it exists there. */
function worktreeCwd(repo: RepoInfo, worktreePath: string, cwd: string): string {
	const rel = relative(repo.root, canonicalPath(cwd));
	const sub = rel && !rel.startsWith("..") && !isAbsolute(rel) ? join(worktreePath, rel) : worktreePath;
	return existsSync(sub) ? sub : worktreePath;
}

/**
 * Create a worktree for a session on a new branch `<date>-<slug>` from HEAD of the main checkout.
 * A taken name (directory or branch) gets `-2`, `-3`, ... Throws when git fails.
 */
export function createSessionWorktree(options: {
	repo: RepoInfo;
	cwd: string;
	sessionId: string;
	slug: string;
	date: Date;
}): SessionWorktree {
	const { repo } = options;
	const worktreesDir = join(repo.root, WORKTREES_DIR);
	mkdirSync(worktreesDir, { recursive: true });
	ensureIgnored(repo);
	const baseName = `${formatWorktreeDate(options.date)}-${options.slug}`;
	let name = baseName;
	for (let n = 2; existsSync(join(worktreesDir, name)) || branchExists(repo.root, name); n++) {
		name = `${baseName}-${n}`;
	}
	const path = join(worktreesDir, name);
	const base = git(repo.root, ["rev-parse", "HEAD"]);
	const status = git(repo.root, ["status", "--porcelain"]);
	const dirtyCount = status ? status.split("\n").length : 0;
	git(repo.root, ["worktree", "add", "-b", name, path, base]);
	return {
		sessionId: options.sessionId,
		mainRoot: repo.root,
		path,
		branch: name,
		base,
		cwd: worktreeCwd(repo, path, options.cwd),
		dirtyCount,
	};
}

/**
 * Re-enter the worktree a session recorded. Recreates it from its branch when the directory is
 * gone. Returns undefined when that fails, for example because the branch was deleted.
 */
export function restoreSessionWorktree(data: WorktreeEntryData, cwd: string): SessionWorktree | undefined {
	const repo = detectRepo(data.mainRoot);
	if (!repo) return undefined;
	try {
		if (!existsSync(data.path)) {
			gitSucceeds(repo.root, ["worktree", "prune"]);
			git(repo.root, ["worktree", "add", data.path, data.branch]);
		}
	} catch {
		return undefined;
	}
	return { ...data, cwd: worktreeCwd(repo, data.path, cwd) };
}

/**
 * Where `path` (absolute) lives in the worktree when it points into the main checkout outside
 * `.worktrees/`; undefined otherwise.
 */
export function remapToWorktree(path: string, mainRoot: string, worktreePath: string): string | undefined {
	const canonical = canonicalPath(path);
	if (!isWithin(canonical, mainRoot) || isWithin(canonical, join(mainRoot, WORKTREES_DIR))) return undefined;
	return join(worktreePath, relative(mainRoot, canonical));
}
