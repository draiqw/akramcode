/**
 * Finding, launching, and reusing the automation Chrome.
 *
 * Chrome runs with its own profile (`<agentDir>/browser-profile`), never the user's default one:
 * Chrome 136+ refuses remote debugging on the default profile, and the user's tabs and sign-ins stay
 * untouched. It listens on a free port (`--remote-debugging-port=0`) and writes the port to
 * `DevToolsActivePort` in the profile, which later sessions read to reuse the running instance.
 *
 * On macOS a windowed Chrome is started with `open -g -n`, so it opens behind the current app
 * instead of taking focus. The anti-throttling flags keep pages in that background window running
 * and painting (screenshots of a throttled window hang).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
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

/** The browser WebSocket URL of a Chrome already running on this profile, if any. */
async function runningInstance(profileDir: string): Promise<string | undefined> {
	const file = join(profileDir, "DevToolsActivePort");
	if (!existsSync(file)) return undefined;
	const port = Number.parseInt(readFileSync(file, "utf8").split("\n")[0] ?? "", 10);
	if (!Number.isFinite(port) || port <= 0) return undefined;
	return browserWsUrl(`http://127.0.0.1:${port}`);
}

/**
 * A stale `SingletonLock` from a crashed Chrome makes the next start show "Something went wrong
 * when opening your profile". Remove it when its owner process is gone.
 */
function clearStaleLock(profileDir: string): void {
	const lock = join(profileDir, "SingletonLock");
	let target: string;
	try {
		target = readlinkSync(lock);
	} catch {
		return;
	}
	const pid = Number.parseInt(target.slice(target.lastIndexOf("-") + 1), 10);
	if (Number.isFinite(pid)) {
		try {
			process.kill(pid, 0);
			return;
		} catch {
			// Owner is gone.
		}
	}
	for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
		rmSync(join(profileDir, name), { force: true });
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

function launch(chrome: string, args: string[], headless: boolean): void {
	const isAppBundle = chrome.endsWith(".app") && statSync(chrome).isDirectory();
	if (process.platform === "darwin" && isAppBundle && !headless) {
		// -g: do not bring it to the front; -n: a new instance even when the user's Chrome runs.
		spawn("open", ["-g", "-n", "-a", chrome, "--args", ...args], { detached: true, stdio: "ignore" }).unref();
		return;
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
	spawn(executable, args, { detached: true, stdio: "ignore" }).unref();
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

	const chrome = findChrome(options.executablePath);
	if (!chrome) {
		throw new Error(
			options.executablePath
				? `browser.executablePath ${options.executablePath} does not exist`
				: "Chrome or Chromium is not installed. Install it or set browser.executablePath.",
		);
	}
	mkdirSync(options.profileDir, { recursive: true });
	clearStaleLock(options.profileDir);
	rmSync(join(options.profileDir, "DevToolsActivePort"), { force: true });
	launch(chrome, chromeArgs(options.profileDir, options.headless), options.headless);

	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		const url = await runningInstance(options.profileDir);
		if (url) return url;
	}
	throw new Error(`Chrome did not start within ${START_TIMEOUT_MS / 1000}s (profile ${options.profileDir})`);
}
