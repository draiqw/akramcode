/** State of one tool call in a collapsed tool group. */
export interface ToolGroupItem {
	toolName: string;
	args: unknown;
	status: "running" | "done" | "error";
}

export interface ToolGroupSummary {
	/** Finished calls, e.g. "Read 2 files, ran 1 shell command". Empty when nothing has finished yet. */
	done: string;
	/** The first running call, e.g. "Running ls -la". */
	active?: string;
	failed: number;
}

interface ToolKind {
	/** Key that merges tools with the same wording, e.g. grep and find. */
	key: string;
	done: (count: number) => string;
	active: string;
	/** Short description of the call's target, shown while it runs. */
	target?: (args: Record<string, unknown>) => string | undefined;
}

const ACTIVE_TARGET_MAX_LENGTH = 60;

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

function stringArg(args: Record<string, unknown>, name: string): string | undefined {
	const value = args[name];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const pathTarget = (args: Record<string, unknown>) => stringArg(args, "path");
const patternTarget = (args: Record<string, unknown>) => stringArg(args, "pattern");

const TOOL_KINDS: Record<string, ToolKind> = {
	read: { key: "read", done: (n) => `read ${plural(n, "file")}`, active: "Reading", target: pathTarget },
	bash: {
		key: "bash",
		done: (n) => `ran ${plural(n, "shell command")}`,
		active: "Running",
		target: (args) => stringArg(args, "command")?.split("\n")[0],
	},
	edit: { key: "edit", done: (n) => `edited ${plural(n, "file")}`, active: "Editing", target: pathTarget },
	write: { key: "write", done: (n) => `wrote ${plural(n, "file")}`, active: "Writing", target: pathTarget },
	grep: { key: "search", done: (n) => `searched ${plural(n, "time")}`, active: "Searching", target: patternTarget },
	find: { key: "search", done: (n) => `searched ${plural(n, "time")}`, active: "Searching", target: patternTarget },
	ls: {
		key: "ls",
		done: (n) => `listed ${plural(n, "directory", "directories")}`,
		active: "Listing",
		target: pathTarget,
	},
	agent: {
		key: "agent",
		done: (n) => `ran ${plural(n, "agent")}`,
		active: "Running agent",
		target: (args) => stringArg(args, "description"),
	},
	task_stop: { key: "task_stop", done: (n) => `stopped ${plural(n, "task")}`, active: "Stopping task" },
	question: { key: "question", done: (n) => `asked ${plural(n, "question")}`, active: "Asking" },
	codemode: { key: "codemode", done: (n) => `ran ${plural(n, "script")}`, active: "Running script" },
	update_plan: {
		key: "update_plan",
		done: (n) => `updated the plan${n > 1 ? ` ${n} times` : ""}`,
		active: "Updating plan",
	},
};

function getToolKind(toolName: string): ToolKind {
	return (
		TOOL_KINDS[toolName] ?? {
			key: `tool:${toolName}`,
			done: (n) => `called ${toolName}${n > 1 ? ` ${n} times` : ""}`,
			active: `Calling ${toolName}`,
		}
	);
}

function truncate(text: string, maxLength: number): string {
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/**
 * Summarize a group of tool calls as one line, Claude Code style.
 * `thought` is collapsed thinking folded into the group, e.g. "thought for 3s"; it leads the line.
 */
export function summarizeToolGroup(items: readonly ToolGroupItem[], thought?: string): ToolGroupSummary {
	const counts = new Map<string, { kind: ToolKind; count: number }>();
	let failed = 0;
	let active: string | undefined;
	for (const item of items) {
		const kind = getToolKind(item.toolName);
		if (item.status === "running") {
			if (active === undefined) {
				const args =
					typeof item.args === "object" && item.args !== null ? (item.args as Record<string, unknown>) : {};
				const target = kind.target?.(args);
				active = target ? `${kind.active} ${truncate(target, ACTIVE_TARGET_MAX_LENGTH)}` : kind.active;
			}
			continue;
		}
		if (item.status === "error") failed++;
		const entry = counts.get(kind.key);
		if (entry) {
			entry.count++;
		} else {
			counts.set(kind.key, { kind, count: 1 });
		}
	}
	const parts = [...(thought ? [thought] : []), ...[...counts.values()].map(({ kind, count }) => kind.done(count))];
	const done = parts.join(", ");
	return {
		done: done ? done.charAt(0).toUpperCase() + done.slice(1) : "",
		...(active ? { active } : {}),
		failed,
	};
}
