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
 * and painting (screenshots of a throttled window hang). `akramcode-launch.json` in the profile
 * records whether the running Chrome is headless, so a change of `browser.view` restarts it.
 *
 * `browser.useMyChrome` drives the user's everyday Chrome instead. Chrome 144+ allows that after the
 * user enables remote debugging at `chrome://inspect/#remote-debugging`; Chrome then writes
 * `DevToolsActivePort` to its own user data directory and asks the user to allow each connection.
 */

import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { delimiter, join } from "node:path";
import { CdpConnection } from "./cdp.ts";

const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 10_000;
const POLL_MS = 200;
const LAUNCH_FILE = "akramcode-launch.json";

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

/**
 * How Chrome starts: `headless` without a window; `background` with windows that stay behind other
 * apps where the platform allows; `foreground` with a normal window in front, for signing in.
 */
export type LaunchMode = "headless" | "background" | "foreground";

export function chromeArgs(profileDir: string, mode: LaunchMode): string[] {
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
	if (mode === "headless") args.push("--headless=new");
	else if (mode === "background") args.push("--no-startup-window");
	// Tests run Chrome under a temporary HOME with no keychain; a mock one avoids the macOS keychain prompt.
	// Never set this for a lasting profile: cookies and passwords saved with the real keychain become unreadable.
	if (process.env.AKRAMCODE_CHROME_MOCK_KEYCHAIN === "1") args.push("--use-mock-keychain");
	return args;
}

/** Start Chrome detached; rejects when it cannot be started (for example a non-executable path). */
function launch(chrome: string, args: string[], mode: LaunchMode): Promise<void> {
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
	if (process.platform === "darwin" && isAppBundle && mode !== "headless") {
		// -g: do not bring it to the front; -n: a new instance even when the user's Chrome runs.
		return start("open", [...(mode === "background" ? ["-g"] : []), "-n", "-a", chrome, "--args", ...args]);
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
	const mode: LaunchMode = options.headless ? "headless" : "background";
	const running = await runningInstance(options.profileDir);
	if (running) {
		// Started before `akramcode-launch.json` existed: headless, the only mode then.
		if ((readLaunch(options.profileDir)?.headless ?? true) === options.headless) return running;
		await stopChrome(options.profileDir);
	}
	return launchChrome(options, mode);
}

/** Launch Chrome on the profile and return its browser WebSocket URL. */
async function launchChrome(options: ChromeOptions, mode: LaunchMode): Promise<string> {
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
	writeFileSync(join(options.profileDir, LAUNCH_FILE), JSON.stringify({ headless: mode === "headless" }));
	await launch(chrome, chromeArgs(options.profileDir, mode), mode);
	const url = await waitForEndpoint();
	if (url) return url;
	throw new Error(`Chrome did not start within ${timeoutMs / 1000}s (profile ${options.profileDir})`);
}

function readLaunch(profileDir: string): { headless?: boolean } | undefined {
	try {
		return JSON.parse(readFileSync(join(profileDir, LAUNCH_FILE), "utf8")) as { headless?: boolean };
	} catch {
		return undefined;
	}
}

/** Quit the Chrome running on the profile, if any, and wait until it is gone. */
export async function stopChrome(profileDir: string): Promise<void> {
	const url = await runningInstance(profileDir);
	if (!url) return;
	try {
		const cdp = await CdpConnection.connect(url);
		await cdp.send("Browser.close").catch(() => {});
		cdp.close();
	} catch {
		// Gone already.
	}
	const deadline = Date.now() + STOP_TIMEOUT_MS;
	while (Date.now() < deadline && (await runningInstance(profileDir))) {
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	}
}

/**
 * Restart the profile's Chrome with a normal window in front, for signing in to sites by hand.
 * The cookies stay in the profile; `stopChrome()` closes it afterwards.
 */
export async function openForSignIn(options: Omit<ChromeOptions, "headless" | "cdpUrl">): Promise<void> {
	await stopChrome(options.profileDir);
	await launchChrome({ ...options, headless: false }, "foreground");
}

/** The user data directory of the user's everyday Google Chrome. */
export function myChromeDataDir(): string {
	return join(homedir(), "Library", "Application Support", "Google", "Chrome");
}

export const MY_CHROME_SETUP =
	'In your Chrome, open chrome://inspect/#remote-debugging and check "Allow remote debugging for this browser instance".';

/**
 * Ports on 127.0.0.1 that the user's own Chrome listens on: Google Chrome processes started without
 * `--user-data-dir`, which every Chrome AkramCode launches has.
 */
export function myChromePorts(): number[] {
	let output = "";
	try {
		output = execFileSync("lsof", ["-nP", "-a", "-iTCP@127.0.0.1", "-sTCP:LISTEN", "-c", "Google"], {
			encoding: "utf8",
			timeout: 5000,
		});
	} catch {
		// lsof exits 1 when nothing matches.
		return [];
	}
	const ports: number[] = [];
	for (const line of output.split("\n").slice(1)) {
		const columns = line.trim().split(/\s+/);
		const pid = Number.parseInt(columns[1] ?? "", 10);
		const port = Number.parseInt(/:(\d+)$/.exec(columns[8] ?? "")?.[1] ?? "", 10);
		if (!Number.isFinite(pid) || !Number.isFinite(port)) continue;
		let args = "";
		try {
			args = execFileSync("ps", ["-p", String(pid), "-o", "args="], { encoding: "utf8", timeout: 2000 });
		} catch {
			continue;
		}
		if (args.includes("Google Chrome") && !args.includes("--user-data-dir")) ports.push(port);
	}
	return [...new Set(ports)];
}

/**
 * Browser WebSocket URL of the user's everyday Chrome. Chrome writes its port to `DevToolsActivePort`
 * in its data directory, but macOS may not let other apps read that directory; then the port is the
 * one Chrome listens on. The browser endpoint answers on any `/devtools/browser` path.
 */
export function myChromeUrl(dataDir = myChromeDataDir(), ports: () => number[] = myChromePorts): string {
	try {
		const [portLine = "", path = ""] = readFileSync(join(dataDir, "DevToolsActivePort"), "utf8").split("\n");
		const port = Number.parseInt(portLine, 10);
		if (Number.isFinite(port) && port > 0 && path.trim().startsWith("/devtools/browser/")) {
			return `ws://127.0.0.1:${port}${path.trim()}`;
		}
	} catch {
		// Missing, or not readable for this app.
	}
	const [port] = ports();
	if (port === undefined) throw new Error(`Remote debugging is off in your Chrome. ${MY_CHROME_SETUP}`);
	return `ws://127.0.0.1:${port}/devtools/browser`;
}
