/** Single-quote a value for POSIX shells. */
export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Prefix a command with the variables the sandbox should see. Only AKRAMCODE_* variables are
 * forwarded: the host environment (PATH, credentials) must not leak into the sandbox.
 */
export function withForwardedEnv(command: string, env: NodeJS.ProcessEnv | undefined): string {
	const exports: string[] = [];
	for (const [name, value] of Object.entries(env ?? {})) {
		if (value === undefined || !name.startsWith("AKRAMCODE_") || !ENV_NAME.test(name)) continue;
		exports.push(`export ${name}=${shellQuote(value)}`);
	}
	return exports.length === 0 ? command : `${exports.join("; ")}\n${command}`;
}
