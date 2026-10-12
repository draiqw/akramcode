/**
 * Finding, launching, and reusing the automation Chrome.
 *
 * Chrome runs with its own profile (`<agentDir>/browser-profile`), never the user's default one:
 * Chrome 136+ refuses remote debugging on the default profile, and the user's tabs and sign-ins stay
 * untouched. It listens on a free port (`--remote-debugging-port=0`) and writes the port to
 * `DevToolsActivePort` in the profile, which later sessions read to reuse the running instance.
 *
 * Chrome is headless by default: a windowed Chrome on macOS takes focus when it opens windows, even
 * when started with `open -g`. The anti-throttling flags keep pages in a background window running
 * and painting (screenshots of a throttled window hang).
 */

import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { delimiter, join } from "node:path";

const START_TIMEOUT_MS = 30_000;
const POLL_MS = 200;

export interface ChromeOptions {
	profileDir: string;
	headless: boolean;
	/** Executable or macOS `.app` bundle; found automatically when unset. */
	executablePath?: string;
	/** Attach here instead of launching. `http://host:port` or a `ws://` browser URL. */
	cdpUrl?: string;
	/** How long to wait for Chrome to answer. Default: 30s. */
	startTimeoutMs?: number;
}

const MAC_APPS = ["Google Chrome.app", "Chromium.app", "Google Chrome Canary.app"];
const LINUX_BINARIES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"];

/** The Chrome to launch: a macOS `.app` bundle or an executable. Undefined when none is installed. */
export function findChrome(executablePath?: string): string | undefined {
	if (executablePath) {
		const path = executablePath.startsWith("~/") ? join(homedir(), executablePath.slice(2)) : executablePath;
		return existsSync(path) ? path : undefined;
	}
	if (process.platform === "darwin") {
		for (const dir of ["/Applications", join(homedir(), "Applications")]) {
			for (const app of MAC_APPS) {
				const path = join(dir, app);
				if (existsSync(path)) return path;
			}
		}
		return undefined;
	}
	if (process.platform === "win32") {
		for (const base of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]) {
			const path = base && join(base, "Google", "Chrome", "Application", "chrome.exe");
			if (path && existsSync(path)) return path;
		}
		return undefined;
	}
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		for (const name of LINUX_BINARIES) {
			const path = join(dir, name);
			if (dir && existsSync(path)) return path;
		}
	}
	return undefined;
}

/** `webSocketDebuggerUrl` of a CDP endpoint, or undefined when it does not answer. */
async function browserWsUrl(httpUrl: string): Promise<string | undefined> {
	try {
		const response = await fetch(`${httpUrl.replace(/\/$/, "")}/json/version`, {
			signal: AbortSignal.timeout(2000),
		});
		if (!response.ok) return undefined;
		const body = (await response.json()) as { webSocketDebuggerUrl?: string };
		return body.webSocketDebuggerUrl;
	} catch {
		return undefined;
	}
}

/**
 * The browser WebSocket URL of a Chrome already running on this profile, if any. The file outlives
 * Chrome, so the endpoint must also be the browser it names: another program may own the port now.
 */
async function runningInstance(profileDir: string): Promise<string | undefined> {
	const file = join(profileDir, "DevToolsActivePort");
	if (!existsSync(file)) return undefined;
	const [portLine = "", path = ""] = readFileSync(file, "utf8").split("\n");
	const port = Number.parseInt(portLine, 10);
	if (!Number.isFinite(port) || port <= 0) return undefined;
	const url = await browserWsUrl(`http://127.0.0.1:${port}`);
	return url && (!path.trim() || url.endsWith(path.trim())) ? url : undefined;
}

/** Name of the running process `pid`, or undefined when there is none. */
function processName(pid: number): string | undefined {
	try {
		process.kill(pid, 0);
	} catch {
		return undefined;
	}
	try {
		return execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8", timeout: 2000 }).trim();
	} catch {
		// Alive, but `ps` is unavailable: assume it is Chrome rather than break its profile.
		return "chrome";
	}
}

/**
 * Whether the `SingletonLock` target (`<host>-<pid>`) names a running Chrome on this host. After a
 * crash and reboot the pid often belongs to an unrelated process, which must not count.
 */
export function lockHeldByChrome(
	target: string,
	host = hostname(),
	nameOf: (pid: number) => string | undefined = processName,
): boolean {
	const dash = target.lastIndexOf("-");
	const pid = Number.parseInt(target.slice(dash + 1), 10);
	if (dash <= 0 || !Number.isFinite(pid) || target.slice(0, dash) !== host) return false;
	// Chromium-based browsers that `browser.executablePath` may name.
	return /chrom|brave|edge|vivaldi|opera/i.test(nameOf(pid) ?? "");
}

/** Whether a running Chrome holds the profile's `SingletonLock` (a symlink to `<host>-<pid>`). */
function lockOwnerAlive(profileDir: string): boolean {
	try {
		return lockHeldByChrome(readlinkSync(join(profileDir, "SingletonLock")));
	} catch {
		return false;
	}
}

export function chromeArgs(profileDir: string, headless: boolean): string[] {
	const args = [
		`--user-data-dir=${profileDir}`,
		"--remote-debugging-port=0",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-backgrounding-occluded-windows",
		"--disable-renderer-backgrounding",
		"--disable-background-timer-throttling",
		"--window-size=1280,900",
	];
	// Without a startup window Chrome has nothing to bring to the front; tabs are opened over CDP.
	args.push(headless ? "--headless=new" : "--no-startup-window");
	return args;
}

/** Start Chrome detached; rejects when it cannot be started (for example a non-executable path). */
function launch(chrome: string, args: string[], headless: boolean): Promise<void> {
	const start = (command: string, commandArgs: string[]) =>
		new Promise<void>((resolve, reject) => {
			const child = spawn(command, commandArgs, { detached: true, stdio: "ignore" });
			// Without a listener a spawn error is an uncaught exception that ends the process.
			child.once("error", (error) => reject(new Error(`Could not start ${chrome}: ${error.message}`)));
			child.once("spawn", () => {
				child.unref();
				resolve();
			});
		});
	const isAppBundle = chrome.endsWith(".app") && statSync(chrome).isDirectory();
	if (process.platform === "darwin" && isAppBundle && !headless) {
		// -g: do not bring it to the front; -n: a new instance even when the user's Chrome runs.
		return start("open", ["-g", "-n", "-a", chrome, "--args", ...args]);
	}
	const executable = isAppBundle
		? join(
				chrome,
				"Contents",
				"MacOS",
				chrome
					.split("/")
					.pop()!
					.replace(/\.app$/, ""),
			)
		: chrome;
	return start(executable, args);
}

/**
 * The browser WebSocket URL to connect to: the configured `cdpUrl`, a Chrome already running on
 * the profile, or a newly launched one.
 */
export async function ensureChrome(options: ChromeOptions): Promise<string> {
	if (options.cdpUrl) {
		if (options.cdpUrl.startsWith("ws://") || options.cdpUrl.startsWith("wss://")) return options.cdpUrl;
		const url = await browserWsUrl(options.cdpUrl);
		if (!url) throw new Error(`No browser answers at browser.cdpUrl ${options.cdpUrl}`);
		return url;
	}
	const running = await runningInstance(options.profileDir);
	if (running) return running;
	const timeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS;

	const chrome = findChrome(options.executablePath);
	if (!chrome) {
		throw new Error(
			options.executablePath
				? `browser.executablePath ${options.executablePath} does not exist`
				: "Chrome or Chromium is not installed. Install it or set browser.executablePath.",
		);
	}
	const waitForEndpoint = async (): Promise<string | undefined> => {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
			const url = await runningInstance(options.profileDir);
			if (url) return url;
		}
		return undefined;
	};
	// A Chrome holds the profile (starting, or too busy to answer): a second one would hand over to it
	// and exit, so wait for it instead of launching.
	if (lockOwnerAlive(options.profileDir)) {
		const url = await waitForEndpoint();
		if (url) return url;
		throw new Error(
			`A Chrome is running on ${options.profileDir} but does not answer over DevTools. Quit it and retry.`,
		);
	}
	mkdirSync(options.profileDir, { recursive: true, mode: 0o700 });
	// The mode applies only to a new directory; the profile holds cookies and logins.
	chmodSync(options.profileDir, 0o700);
	// A stale lock from a crashed Chrome makes the next start show "Something went wrong when opening
	// your profile"; its owner is gone, so remove it.
	for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket", "DevToolsActivePort"]) {
		rmSync(join(options.profileDir, name), { force: true });
	}
	await launch(chrome, chromeArgs(options.profileDir, options.headless), options.headless);
	const url = await waitForEndpoint();
	if (url) return url;
	throw new Error(`Chrome did not start within ${timeoutMs / 1000}s (profile ${options.profileDir})`);
}
