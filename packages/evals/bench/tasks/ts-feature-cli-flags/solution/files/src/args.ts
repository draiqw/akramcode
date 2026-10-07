export interface ParsedArgs {
	command: string | undefined;
	positionals: string[];
	flags: Map<string, string | true>;
}

/** Flags that take a value: `--name value` is accepted in addition to `--name=value`. */
const VALUE_FLAGS = new Set(["limit"]);

/** Parse `--flag` and `--flag=value` options; everything else is positional. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
	const positionals: string[] = [];
	const flags = new Map<string, string | true>();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--")) {
			const eq = arg.indexOf("=");
			if (eq >= 0) {
				flags.set(arg.slice(2, eq), arg.slice(eq + 1));
			} else {
				const name = arg.slice(2);
				const next = argv[i + 1];
				if (VALUE_FLAGS.has(name) && next !== undefined && !next.startsWith("--")) {
					flags.set(name, next);
					i++;
				} else {
					flags.set(name, true);
				}
			}
		} else {
			positionals.push(arg);
		}
	}
	return { command: positionals[0], positionals: positionals.slice(1), flags };
}
