/**
 * Shell commands that always need the user's confirmation before the `bash` tool runs them: they
 * delete files or history and cannot be undone. The check is built in and has no setting, so no
 * settings file, project, or extension can turn it off. It applies to every `bash` call, including
 * calls from subagents, codemode scripts, and workflows. Commands the user types with `!` are not
 * checked.
 *
 * Matching is textual. Line continuations are joined, and the command is also matched with quotes
 * and backslashes removed, so `r''m` and `bash -c "rm x"` are caught. It does not see deletions made
 * by other programs, such as a Python script that removes files.
 */

/** Within one simple command: no `;`, `&`, `|`, or line break in between. */
const SAME = "[^;&|\\n]*";

/**
 * A program in command position: at the start, after a separator, or after a wrapper such as
 * `sudo`, `xargs`, `env`, a variable assignment, `-exec`, or `-c`; a path before it is allowed.
 */
function program(name: string): RegExp {
	const start = "(?:^|[;&|(`{!\\n]|\\$\\(|-exec\\s|-c\\s)";
	const wrappers =
		"(?:(?:sudo|doas|command|exec|eval|nohup|time|nice|ionice|stdbuf|watch|env|busybox|xargs|then|do|else)(?:\\s+-\\S+)*\\s+|timeout(?:\\s+-\\S+)*\\s+\\S+\\s+|[A-Za-z_]\\w*=\\S*\\s+)*";
	return new RegExp(`${start}\\s*${wrappers}(?:[^\\s;&|]*/)?${name}(?![\\w.-])`);
}

/**
 * `git <subcommand> ...` within one simple command. Only global options such as `-C dir` may come
 * before the subcommand, so `git commit -m "fix rm"` is not `git rm`.
 */
function git(subcommand: string, rest = ""): RegExp {
	const options = "(?:\\s+(?:-[Cc]\\s+\\S+|--(?:git-dir|work-tree|namespace)\\s+\\S+|-\\S+))*";
	return new RegExp(`${program("git").source}${options}\\s+${subcommand}(?![\\w-])${rest ? `${SAME}${rest}` : ""}`);
}

/** Text after the first match of `pattern`, up to the end of that simple command. */
function after(command: string, pattern: RegExp): string | undefined {
	const match = pattern.exec(command);
	return match ? (/^[^;&|\n]*/.exec(command.slice(match.index + match[0].length))?.[0] ?? "") : undefined;
}

const DANGEROUS: ReadonlyArray<{ label: string; test: (command: string) => boolean }> = [
	{ label: "rm", test: (c) => program("rm").test(c) },
	{ label: "rmdir", test: (c) => program("rmdir").test(c) },
	{ label: "unlink", test: (c) => program("unlink").test(c) },
	{ label: "shred", test: (c) => program("shred").test(c) },
	{ label: "truncate", test: (c) => program("truncate").test(c) },
	{ label: "find -delete", test: (c) => new RegExp(`\\bfind\\b${SAME}\\s-delete\\b`).test(c) },
	{ label: "rsync --delete", test: (c) => new RegExp(`\\brsync\\b${SAME}\\s--delete`).test(c) },
	{
		label: "git push --force",
		test: (c) =>
			git(
				"push",
				"(\\s--force(-with-lease|-if-includes)?\\b|\\s-[a-zA-Z]*f[a-zA-Z]*\\b|\\s\\+[^\\s;&|]+|\\s--mirror\\b|\\s--prune\\b)",
			).test(c),
	},
	{
		label: "git push --delete",
		test: (c) => git("push", "(\\s--delete\\b|\\s-d\\b|\\s:[^\\s;&|]+)").test(c),
	},
	{ label: "git reset --hard", test: (c) => git("reset", "\\s--hard\\b").test(c) },
	{ label: "git clean", test: (c) => git("clean", "(\\s-[a-zA-Z]*f[a-zA-Z]*\\b|\\s--force\\b)").test(c) },
	{
		label: "git checkout (discard changes)",
		test: (c) => git("checkout", "(\\s--(\\s|$)|\\s\\.(\\s|$)|\\s-f\\b|\\s--force\\b|\\s-B\\b)").test(c),
	},
	{
		label: "git switch --discard-changes",
		test: (c) => git("switch", "(\\s-f\\b|\\s--force\\b|\\s--discard-changes\\b)").test(c),
	},
	{
		// `--staged` alone only unstages; the working tree is untouched.
		label: "git restore",
		test: (c) => {
			const rest = after(c, git("restore"));
			return rest !== undefined && (!/\s(--staged|-S)\b/.test(rest) || /\s(--worktree|-W)\b/.test(rest));
		},
	},
	{
		// `git rm --cached` only untracks; the file stays.
		label: "git rm",
		test: (c) => {
			const rest = after(c, git("rm"));
			return rest !== undefined && !/\s--cached\b/.test(rest);
		},
	},
	{
		label: "git branch -D",
		test: (c) =>
			git(
				"branch",
				"(\\s-[a-zA-Z]*D[a-zA-Z]*\\b|\\s-[a-zA-Z]*f[a-zA-Z]*\\b|\\s--force\\b|\\s--delete\\s[^;&|\\n]*--force\\b)",
			).test(c),
	},
	{ label: "git stash drop/clear", test: (c) => git("stash\\s+(drop|clear)").test(c) },
	{ label: "git update-ref -d", test: (c) => git("update-ref", "\\s-d\\b").test(c) },
	{ label: "git reflog expire", test: (c) => git("reflog", "\\bexpire\\b").test(c) },
	{ label: "git gc --prune", test: (c) => git("gc", "\\s--prune\\b").test(c) },
	{ label: "git filter-branch", test: (c) => git("filter-(branch|repo)").test(c) },
	{
		label: "git worktree remove --force",
		test: (c) => git("worktree", "\\sremove\\b[^;&|\\n]*\\s(-f|--force)\\b").test(c),
	},
	{ label: "sudo", test: (c) => program("sudo").test(c) || program("doas").test(c) },
	{ label: "dd", test: (c) => new RegExp(`${program("dd").source}${SAME}\\bof=`).test(c) },
	{ label: "mkfs", test: (c) => program("mkfs(\\.\\w+)?").test(c) },
	{ label: "diskutil erase", test: (c) => /\bdiskutil\s+(erase\w*|zeroDisk|randomDisk|secureErase)\b/.test(c) },
];

/** Labels of the dangerous operations in `command`, in list order; empty when there are none. */
export function findDangerousCommands(command: string): string[] {
	const joined = command.replace(/\\\r?\n/g, " ");
	const unquoted = joined.replace(/['"\\]/g, "");
	return DANGEROUS.filter(({ test }) => test(joined) || test(unquoted)).map(({ label }) => label);
}
