import { parseArgs } from "./args.ts";
import { formatCount } from "./commands/count.ts";
import { formatText, selectItems } from "./commands/list.ts";
import { type CliResult, type Item, UsageError } from "./types.ts";

const KNOWN_FLAGS: Record<string, readonly string[]> = {
	list: ["all"],
	count: [],
};

function checkFlags(command: string, flags: Map<string, string | true>): void {
	const known = KNOWN_FLAGS[command] ?? [];
	for (const name of flags.keys()) {
		if (!known.includes(name)) throw new UsageError(`unknown flag --${name}`);
	}
}

function run(argv: readonly string[], items: readonly Item[]): string {
	const { command, flags } = parseArgs(argv);
	if (command === undefined) throw new UsageError("missing command");
	if (!(command in KNOWN_FLAGS)) throw new UsageError(`unknown command ${command}`);
	checkFlags(command, flags);
	if (command === "count") return formatCount(items);
	return formatText(selectItems(items, { all: flags.has("all") }));
}

export function main(argv: readonly string[], items: readonly Item[]): CliResult {
	try {
		return { exitCode: 0, stdout: run(argv, items), stderr: "" };
	} catch (error) {
		if (error instanceof UsageError) return { exitCode: 2, stdout: "", stderr: `error: ${error.message}\n` };
		throw error;
	}
}
