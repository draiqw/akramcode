/**
 * Shell commands that always need the user's confirmation before the `bash` tool runs them: they
 * delete files or history and cannot be undone. The check is built in and has no setting, so no
 * settings file, project, or extension can turn it off. It applies to every `bash` call, including
 * calls from subagents, codemode scripts, and workflows. Commands the user types with `!` are not
 * checked.
 *
 * Matching is textual and errs toward asking: `echo rm` asks too. It does not see deletions made by
 * other programs, such as a Python script that removes files.
 */

/** A command word: not part of a longer word, path segments allowed before it (`/bin/rm`, `\rm`). */
function word(name: string): RegExp {
	return new RegExp(`(?<![\\w.-])${name}(?![\\w.-])`);
}

/** Within one simple command: no `;`, `&`, `|`, or line break in between. */
const SAME = "[^;&|\\n]*";

const DANGEROUS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
	{ label: "rm", pattern: word("rm") },
	{ label: "rmdir", pattern: word("rmdir") },
	{ label: "unlink", pattern: word("unlink") },
	{ label: "shred", pattern: word("shred") },
	{ label: "find -delete", pattern: new RegExp(`${word("find").source}${SAME}\\s-delete\\b`) },
	{
		label: "git push --force",
		pattern: new RegExp(
			`\\bgit\\b${SAME}\\bpush\\b${SAME}(\\s--force(-with-lease|-if-includes)?\\b|\\s-[a-zA-Z]*f[a-zA-Z]*\\b|\\s\\+[^\\s;&|]+)`,
		),
	},
	{ label: "git reset --hard", pattern: new RegExp(`\\bgit\\b${SAME}\\breset\\b${SAME}\\s--hard\\b`) },
	{
		label: "git clean",
		pattern: new RegExp(`\\bgit\\b${SAME}\\bclean\\b${SAME}(\\s-[a-zA-Z]*f[a-zA-Z]*\\b|\\s--force\\b)`),
	},
	{
		label: "git checkout (discard changes)",
		pattern: new RegExp(`\\bgit\\b${SAME}\\bcheckout\\b${SAME}(\\s--(\\s|$)|\\s\\.(\\s|$)|\\s-f\\b|\\s--force\\b)`),
	},
	{ label: "git restore", pattern: new RegExp(`\\bgit\\b${SAME}\\brestore\\b`) },
	{
		label: "git branch -D",
		pattern: new RegExp(
			`\\bgit\\b${SAME}\\bbranch\\b${SAME}(\\s-[a-zA-Z]*D[a-zA-Z]*\\b|\\s--delete\\s${SAME}--force\\b)`,
		),
	},
	{ label: "git stash drop/clear", pattern: new RegExp(`\\bgit\\b${SAME}\\bstash\\s+(drop|clear)\\b`) },
	{ label: "sudo", pattern: word("sudo") },
	{ label: "dd", pattern: new RegExp(`${word("dd").source}${SAME}\\bof=`) },
	{ label: "mkfs", pattern: /(?<![\w.-])mkfs(\.\w+)?(?![\w-])/ },
	{ label: "diskutil erase", pattern: /\bdiskutil\s+(erase\w*|zeroDisk|randomDisk|secureErase)\b/ },
];

/** Labels of the dangerous operations in `command`, in list order; empty when there are none. */
export function findDangerousCommands(command: string): string[] {
	return DANGEROUS.filter(({ pattern }) => pattern.test(command)).map(({ label }) => label);
}
