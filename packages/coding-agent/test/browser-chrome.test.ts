import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureChrome, lockHeldByChrome } from "../src/extensions/browser/chrome.ts";

describe("browser Chrome launch", () => {
	let dir = "";
	let server: Server | undefined;
	let fakeChrome: ChildProcess | undefined;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "akramcode-browser-chrome-"));
	});

	afterEach(async () => {
		if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
		server = undefined;
		fakeChrome?.kill();
		fakeChrome = undefined;
		rmSync(dir, { recursive: true, force: true });
	});

	/** A DevTools-like endpoint answering for the browser `/devtools/browser/<id>`. */
	async function endpoint(id: string): Promise<number> {
		server = createServer((_request, response) => {
			const port = (server?.address() as AddressInfo).port;
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/${id}` }));
		});
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
		return (server.address() as AddressInfo).port;
	}

	it("rejects when Chrome cannot be started instead of crashing the process", async () => {
		const notExecutable = join(dir, "chrome");
		writeFileSync(notExecutable, "", { mode: 0o644 });
		await expect(
			ensureChrome({ profileDir: join(dir, "profile"), headless: true, executablePath: notExecutable }),
		).rejects.toThrow(/^Could not start .*EACCES/);
	});

	it("reuses the Chrome named in DevToolsActivePort", async () => {
		const port = await endpoint("MINE");
		writeFileSync(join(dir, "DevToolsActivePort"), `${port}\n/devtools/browser/MINE`);
		expect(await ensureChrome({ profileDir: dir, headless: true })).toBe(
			`ws://127.0.0.1:${port}/devtools/browser/MINE`,
		);
	});

	it("ignores another browser on the stale port and waits for the Chrome holding the profile", async () => {
		const port = await endpoint("OTHER");
		writeFileSync(join(dir, "DevToolsActivePort"), `${port}\n/devtools/browser/MINE`);
		// The lock names a live Chrome on this host, as when Chrome is starting or busy.
		const chromium = join(dir, "Chromium");
		symlinkSync("/bin/sleep", chromium);
		fakeChrome = spawn(chromium, ["30"], { stdio: "ignore" });
		await new Promise((resolve) => fakeChrome?.once("spawn", resolve));
		symlinkSync(`${hostname()}-${fakeChrome.pid}`, join(dir, "SingletonLock"));
		await expect(ensureChrome({ profileDir: dir, headless: true, startTimeoutMs: 300 })).rejects.toThrow(
			/is running on .* but does not answer over DevTools/,
		);
		// Nothing was deleted and nothing was launched.
		expect(existsSync(join(dir, "DevToolsActivePort"))).toBe(true);
	});

	it("counts only a Chrome on this host as the lock owner", () => {
		const names: Record<number, string> = {
			1: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			2: "launchd",
		};
		const nameOf = (pid: number) => names[pid];
		expect(lockHeldByChrome("box-1", "box", nameOf)).toBe(true);
		// After a reboot the pid belongs to another program, or the lock came from another host.
		expect(lockHeldByChrome("box-2", "box", nameOf)).toBe(false);
		expect(lockHeldByChrome("other-1", "box", nameOf)).toBe(false);
		expect(lockHeldByChrome("box-3", "box", nameOf)).toBe(false);
		expect(lockHeldByChrome("my-box-1", "my-box", nameOf)).toBe(true);
	});
});
