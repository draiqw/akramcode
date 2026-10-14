export interface ParsedArgs {
	command: string | undefined;
	positionals: string[];
	flags: Map<string, string | true>;
}

/** Parse `--flag` and `--flag=value` options; everything else is positional. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
	const positionals: string[] = [];
	const flags = new Map<string, string | true>();
	for (const arg of argv) {
		if (arg.startsWith("--")) {
			const eq = arg.indexOf("=");
			if (eq >= 0) flags.set(arg.slice(2, eq), arg.slice(eq + 1));
			else flags.set(arg.slice(2), true);
		} else {
			positionals.push(arg);
		}
	}
	return { command: positionals[0], positionals: positionals.slice(1), flags };
}
