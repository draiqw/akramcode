/**
 * Live smoke test: real headless Chrome against a local HTTP server, driven through the browser
 * extension's tools. Skipped when no Chrome or Chromium is installed.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImageContent, TextContent } from "@akramcode/ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExtensionAPI, ToolDefinition } from "../src/core/extensions/types.ts";
import { CdpConnection } from "../src/extensions/browser/cdp.ts";
import { findChrome } from "../src/extensions/browser/chrome.ts";
import { createBrowserExtension } from "../src/extensions/browser/index.ts";

const PAGE = `<!doctype html>
<html><head><title>Smoke form</title></head><body>
<h1>Order</h1>
<form onsubmit="return false">
  <label>Name <input name="name"></label>
  <label>Size <select name="size"><option>Small</option><option>Medium</option><option>Large</option></select></label>
  <label><input type="checkbox" name="bacon"> Bacon</label>
</form>
<button id="show" onclick="document.getElementById('out').textContent = 'Clicked!'">Show</button>
<p id="out"></p>
<button id="noop">Nothing</button>
<button id="ask" onclick="document.getElementById('answer').textContent = confirm('Really?') ? 'yes' : 'no'">Ask</button>
<p id="answer"></p>
<div style="position:relative"><button id="covered">Covered</button>
  <div style="position:absolute;inset:0;background:white" id="overlay">Cookie banner</div></div>
<div id="slot"><button id="target" onclick="document.getElementById('hits').textContent = 'hit ' + (++window.hits)">Target</button></div>
<p id="hits"></p>
<button id="rerender" onclick="window.hits = window.hits || 0; document.getElementById('slot').innerHTML = document.getElementById('slot').innerHTML">Rerender</button>
<button id="gone">Gone</button>
<button id="remove" onclick="document.getElementById('gone').remove()">Remove</button>
<button id="later" onclick="setTimeout(() => { document.getElementById('late').textContent = 'Arrived late' }, 300)">Later</button>
<p id="late"></p>
<a href="/next">Next page</a>
<div style="height:3000px"></div>
<p>Bottom marker</p>
<script>window.hits = 0;</script>
</body></html>`;

const chrome = findChrome();
type Tool = ToolDefinition;
type Result = { content: (TextContent | ImageContent)[] };

describe.skipIf(!chrome)("browser live smoke", () => {
	let server: Server;
	let base = "";
	let profileDir = "";
	const tools = new Map<string, Tool>();
	const shutdown: Array<() => Promise<void> | void> = [];
	const browserSettings: { headless: boolean; allowedDomains?: string[] } = { headless: true };
	/** Requests that reached the server for the page outside the allowlist. */
	let secretHits = 0;

	const call = async (name: string, params: Record<string, unknown> = {}): Promise<string> => {
		const tool = tools.get(name);
		if (!tool) throw new Error(`No tool ${name}`);
		const result = (await tool.execute("id", params, undefined, undefined, undefined as never)) as Result;
		return result.content.map((part) => (part.type === "text" ? part.text : `[image ${part.mimeType}]`)).join("\n");
	};
	const index = (state: string, pattern: RegExp): number => {
		const match = new RegExp(`\\[(\\d+)\\] ${pattern.source}`).exec(state);
		if (!match) throw new Error(`No element ${pattern} in:\n${state}`);
		return Number(match[1]);
	};

	beforeAll(async () => {
		server = createServer((request, response) => {
			const port = (server.address() as AddressInfo).port;
			if (request.url === "/redirect") {
				// Same server under another host name, which the allowlist does not include.
				response.writeHead(302, { location: `http://localhost:${port}/secret` });
				response.end();
				return;
			}
			if (request.url === "/secret") secretHits++;
			response.setHeader("content-type", "text/html");
			if (request.url === "/leave") {
				response.end(`<title>Leave</title><a href="http://localhost:${port}/secret">Out</a>`);
				return;
			}
			response.end(request.url === "/next" ? "<title>Next</title><p>Second page</p>" : PAGE);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		profileDir = mkdtempSync(join(tmpdir(), "akramcode-browser-live-"));
		const api = {
			getSettings: () => ({ browser: browserSettings }),
			registerTool: (tool: Tool) => tools.set(tool.name, tool),
			registerAgentType: () => {},
			on: (event: string, handler: () => Promise<void>) => {
				if (event === "session_shutdown") shutdown.push(handler);
			},
		};
		await createBrowserExtension({ profileDir })(api as unknown as ExtensionAPI);
	});

	afterAll(async () => {
		for (const handler of shutdown) await handler();
		try {
			const port = readFileSync(join(profileDir, "DevToolsActivePort"), "utf8").split("\n")[0];
			const response = await fetch(`http://127.0.0.1:${port}/json/version`);
			const { webSocketDebuggerUrl } = (await response.json()) as { webSocketDebuggerUrl: string };
			const cdp = await CdpConnection.connect(webSocketDebuggerUrl);
			await cdp.send("Browser.close").catch(() => {});
			cdp.close();
		} catch {
			// Chrome never started.
		}
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(profileDir, { recursive: true, force: true });
	});

	it("reads, fills, clicks, and reports effects", { timeout: 120_000 }, async () => {
		let state = await call("browser_navigate", { url: `${base}/`, new_tab: true });
		expect(state).toContain("title: Smoke form");
		expect(state).toContain("# Order");

		const name = index(state, /textbox "Name"/);
		expect(await call("browser_type", { index: name, text: "Ann" })).toMatch(/value is now "Ann"[\s\S]*changed:/);
		const size = index(state, /select "Size"/);
		expect(await call("browser_select", { index: size, option: "large" })).toContain('Selected "Large"');
		await expect(call("browser_select", { index: size, option: "Huge" })).rejects.toThrow(
			/is not an option.*Small \| Medium \| Large/,
		);
		const bacon = index(state, /checkbox "Bacon"/);
		expect(await call("browser_click", { index: bacon })).toContain("changed:");

		state = await call("browser_state");
		expect(state).toContain('textbox "Name" value="Ann"');
		expect(state).toContain('select "Size" value="Large"');
		expect(state).toMatch(/checkbox "Bacon" checked/);

		expect(await call("browser_click", { index: index(state, /button "Show"/) })).toContain("changed:");
		expect(await call("browser_find_text", { query: "clicked!" })).toContain("1 matches");
		expect(await call("browser_click", { index: index(state, /button "Nothing"/) })).toContain("no_effect: true");

		const ask = await call("browser_click", { index: index(state, /button "Ask"/) });
		expect(ask).toContain('dialog: confirm: "Really?" (dismissed)');
		expect(await call("browser_find_text", { query: "no" })).not.toContain("No match");

		await expect(call("browser_click", { index: index(state, /button "Covered"/) })).rejects.toThrow(
			/ELEMENT COVERED .*<div#overlay> "Cookie banner"/,
		);

		// A re-rendered element is found again; a removed one is a hard error.
		const target = index(state, /button "Target"/);
		await call("browser_click", { index: index(state, /button "Rerender"/) });
		expect(await call("browser_click", { index: target })).toMatch(
			/was stale; found again as \[\d+\] by position and name/,
		);
		await call("browser_click", { index: index(state, /button "Remove"/) });
		await expect(call("browser_click", { index: index(state, /button "Gone"/) })).rejects.toThrow(
			/^STALE ELEMENT HANDLE \[\d+\]: the element was removed or re-rendered and no element matches it now; nothing was clicked/,
		);

		await call("browser_click", { index: index(state, /button "Later"/) });
		expect(await call("browser_wait_for", { text: "Arrived late", timeout_ms: 5000 })).toMatch(/^Condition met/);
		await expect(call("browser_wait_for", { text: "Never", timeout_ms: 600 })).rejects.toThrow(/^TIMEOUT/);

		expect(await call("browser_scroll", {})).toMatch(/^Scrolled page by \d+px/);
		expect(await call("browser_scroll", { pages: 10 })).toContain("Reached the bottom.");
		const bottom = await call("browser_state");
		expect(bottom).toContain("Bottom marker");
		expect(bottom).toMatch(/\d+\.\d pages above, 0\.0 below/);
		expect(await call("browser_keys", { keys: "Tab" })).toMatch(/Pressed Tab[\s\S]*focus:/);

		const shot = await call("browser_screenshot", { max_dim: 400 });
		expect(shot).toMatch(/\[image image\/png\]\nScreenshot of .* \(400x\d+\)/);

		state = await call("browser_scroll", { direction: "up", pages: 20 });
		state = await call("browser_state");
		expect(await call("browser_click", { index: index(state, /link "Next page"/) })).toContain(`url: ${base}/next`);
		expect(await call("browser_back")).toContain("title: Smoke form");

		expect(await call("browser_tabs", { action: "list" })).toMatch(/\(current\) "Smoke form"/);
	});

	it(
		"blocks redirects and links outside browser.allowedDomains before the request is sent",
		{ timeout: 60_000 },
		async () => {
			browserSettings.allowedDomains = ["127.0.0.1"];
			try {
				await expect(call("browser_navigate", { url: `${base}/redirect` })).rejects.toThrow(
					/ERR_BLOCKED_BY_CLIENT\nblocked: http:\/\/localhost:\d+\/secret is outside browser\.allowedDomains/,
				);
				const state = await call("browser_navigate", { url: `${base}/leave` });
				expect(await call("browser_click", { index: index(state, /link "Out"/) })).toContain(
					"blocked: http://localhost:",
				);
				expect(secretHits).toBe(0);
			} finally {
				browserSettings.allowedDomains = undefined;
			}
		},
	);

	it("fails on unknown indices without acting", { timeout: 60_000 }, async () => {
		await expect(call("browser_click", { index: 999_999 })).rejects.toThrow(/^UNKNOWN ELEMENT \[999999\]/);
	});
});
