import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureChrome } from "../src/extensions/browser/chrome.ts";

describe("browser Chrome launch", () => {
	let dir = "";
	let server: Server | undefined;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "akramcode-browser-chrome-"));
	});

	afterEach(async () => {
		if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
		server = undefined;
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
		// The lock names a live process (this one), as when Chrome is starting or busy.
		symlinkSync(`host-${process.pid}`, join(dir, "SingletonLock"));
		await expect(ensureChrome({ profileDir: dir, headless: true, startTimeoutMs: 300 })).rejects.toThrow(
			/is running on .* but does not answer over DevTools/,
		);
		// Nothing was deleted and nothing was launched.
		expect(existsSync(join(dir, "DevToolsActivePort"))).toBe(true);
	});
});
