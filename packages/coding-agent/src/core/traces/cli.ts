/**
 * `akramcode traces`: serve a local, read-only web UI over every stored session, subagent
 * transcript, and their aggregates, to study runs and find where the agent struggles.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { APP_NAME, ENV_SESSION_DIR, expandTildePath, getTracesUiDir } from "../../config.ts";
import { openBrowser } from "../../utils/open-browser.ts";
import { normalizePath } from "../../utils/paths.ts";
import { CAPTURE_DIR_NAME } from "./capture/format.ts";
import { CaptureStore } from "./capture-store.ts";
import { startTracesServer } from "./server.ts";
import { TraceStore } from "./store.ts";

const HELP = `${chalk.bold("Usage:")}
  ${APP_NAME} traces [options]

Start a local, read-only web UI with every stored session and subagent transcript:
a session list with filters, a per-session timeline, and aggregates of tool failures,
grouped errors, retries, aborts, and latency. Live: new sessions appear without restart.
The server binds to 127.0.0.1 only.

Options:
  --port <port>           Port to listen on (default: a free port)
  --open                  Open the UI in the browser
  --session-dir <dir>     Also read sessions from this directory (repeatable)
  --poll <ms>             Re-scan interval for live updates (default: 2000, 0 disables)
  -h, --help              Show this help`;

export interface TracesCommandOptions {
	agentDir: string;
	/** `sessionDir` from settings, if configured. */
	settingsSessionDir?: string;
	/** Resolves when the server should stop. Defaults to SIGINT or SIGTERM. */
	waitForStop?: () => Promise<void>;
	/** Receives the server address and access token once it listens. */
	onListening?: (server: { url: string; baseUrl: string; token: string }) => void;
}

interface ParsedTracesArgs {
	port: number;
	open: boolean;
	sessionDirs: string[];
	pollIntervalMs: number;
	help: boolean;
}

export function parseTracesArgs(args: readonly string[]): ParsedTracesArgs | string {
	const parsed: ParsedTracesArgs = { port: 0, open: false, sessionDirs: [], pollIntervalMs: 2000, help: false };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const value = () => {
			const next = args[i + 1];
			if (next === undefined) throw new Error(`${arg} requires a value`);
			i++;
			return next;
		};
		try {
			if (arg === "-h" || arg === "--help") parsed.help = true;
			else if (arg === "--open") parsed.open = true;
			else if (arg === "--port") {
				const port = Number(value());
				if (!Number.isInteger(port) || port < 0 || port > 65535) return `Invalid --port: ${args[i]}`;
				parsed.port = port;
			} else if (arg === "--poll") {
				const poll = Number(value());
				if (!Number.isFinite(poll) || poll < 0) return `Invalid --poll: ${args[i]}`;
				parsed.pollIntervalMs = poll === 0 ? 0 : Math.max(250, poll);
			} else if (arg === "--session-dir") parsed.sessionDirs.push(normalizePath(value()));
			else return `Unknown option: ${arg}`;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	}
	return parsed;
}

function waitForSignal(): Promise<void> {
	return new Promise((resolveStop) => {
		const stop = () => {
			process.off("SIGINT", stop);
			process.off("SIGTERM", stop);
			resolveStop();
		};
		process.on("SIGINT", stop);
		process.on("SIGTERM", stop);
	});
}

export async function runTracesCommand(args: readonly string[], options: TracesCommandOptions): Promise<number> {
	const parsed = parseTracesArgs(args);
	if (typeof parsed === "string") {
		console.error(chalk.red(`Error: ${parsed}`));
		console.error(chalk.dim(`Use "${APP_NAME} traces --help" for usage.`));
		return 1;
	}
	if (parsed.help) {
		console.log(HELP);
		return 0;
	}

	const envSessionDir = process.env[ENV_SESSION_DIR];
	const roots = [
		join(options.agentDir, "sessions"),
		...(envSessionDir ? [expandTildePath(envSessionDir)] : []),
		...(options.settingsSessionDir ? [options.settingsSessionDir] : []),
		...parsed.sessionDirs,
	];
	const store = new TraceStore({ roots });
	let server: Awaited<ReturnType<typeof startTracesServer>>;
	try {
		server = await startTracesServer({
			store,
			uiDir: getTracesUiDir(),
			port: parsed.port,
			pollIntervalMs: parsed.pollIntervalMs,
			capture: new CaptureStore(join(options.agentDir, CAPTURE_DIR_NAME)),
		});
	} catch (error) {
		console.error(chalk.red(`Error: cannot start traces server: ${error instanceof Error ? error.message : error}`));
		return 1;
	}

	console.log(`${chalk.bold("akramcode traces")} ${server.url}`);
	console.log(chalk.dim(`Reading: ${store.roots.join(", ")}`));
	options.onListening?.(server);
	const launcher = parsed.open ? openWithoutTokenInArgs(server.url) : undefined;
	void store.ready().then(
		() => console.log(chalk.dim(`Indexed ${store.getSummaries().length} sessions. Press Ctrl+C to stop.`)),
		() => {},
	);

	await (options.waitForStop ?? waitForSignal)();
	launcher?.cleanup();
	await server.close();
	return 0;
}

/**
 * Open the tokenized URL without putting the token on a command line, where other local users
 * could read it from the process list: the browser opens a private (0600) local page that
 * redirects to the URL, and the page is deleted shortly after.
 */
export function openWithoutTokenInArgs(
	url: string,
	open: (target: string) => void = openBrowser,
): { file: string; cleanup(): void } {
	const dir = mkdtempSync(join(tmpdir(), "akramcode-traces-open-"));
	const file = join(dir, "open.html");
	const target = url.replace(/[^A-Za-z0-9:/.#=_-]/g, "");
	writeFileSync(
		file,
		`<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${target}"><title>akramcode traces</title>`,
		{ mode: 0o600, flag: "wx" },
	);
	open(file);
	const cleanup = () => rmSync(dir, { recursive: true, force: true });
	setTimeout(cleanup, 60_000).unref();
	return { file, cleanup };
}
