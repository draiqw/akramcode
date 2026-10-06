/** Single-quote a value for POSIX shells. */
export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The session state the bash tool documents. An exact list, not a prefix: AKRAMCODE_SECRETS_KEY
 * and similar variables share the prefix and must never reach the sandbox. The session file path
 * is left out because the file is not readable there.
 */
const FORWARDED_ENV = new Set([
	"AKRAMCODE_SESSION_ID",
	"AKRAMCODE_PROVIDER",
	"AKRAMCODE_MODEL",
	"AKRAMCODE_REASONING_LEVEL",
]);

/** Prefix a command with the variables the sandbox should see; the host environment does not leak into it. */
export function withForwardedEnv(command: string, env: NodeJS.ProcessEnv | undefined): string {
	const exports: string[] = [];
	for (const [name, value] of Object.entries(env ?? {})) {
		if (value === undefined || !FORWARDED_ENV.has(name) || !ENV_NAME.test(name)) continue;
		exports.push(`export ${name}=${shellQuote(value)}`);
	}
	return exports.length === 0 ? command : `${exports.join("; ")}\n${command}`;
}
