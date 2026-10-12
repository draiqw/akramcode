import { describe, expect, it, vi } from "vitest";
import {
	BrowserActionError,
	deltaReport,
	diffProbes,
	looksGenerated,
	type Probe,
	parseKeyCombo,
	reidentify,
	resolveElement,
} from "../src/extensions/browser/actions.ts";
import { Browser, blockedReason, type Tab } from "../src/extensions/browser/browser.ts";
import type { CdpClient } from "../src/extensions/browser/cdp.ts";
import { normalizeUrl } from "../src/extensions/browser/index.ts";
import { type CapturedState, captureState, type ElementFingerprint } from "../src/extensions/browser/state.ts";
import { buildSnapshot, FakeCdp, type FakeNode, VIEWPORT } from "./browser-fixtures.ts";

/** A fake page: the DOM is `body`, live nodes are `alive`, and the main frame has `loaderId`. */
function fakePage(page: { body: FakeNode[]; alive: Set<number>; loaderId: string }) {
	const cdp = new FakeCdp();
	cdp.handlers.set("Page.getFrameTree", () => ({
		frameTree: { frame: { id: "main", loaderId: page.loaderId, url: "https://example.test/page" } },
	}));
	cdp.handlers.set("DOM.resolveNode", (params) => {
		const id = params.backendNodeId as number;
		if (!page.alive.has(id)) throw new Error("No node with given id found");
		return { object: { objectId: `obj-${id}` } };
	});
	cdp.handlers.set("Runtime.callFunctionOn", () => ({ result: { value: true } }));
	cdp.handlers.set("DOMSnapshot.captureSnapshot", () => buildSnapshot(page.body).snapshot);
	cdp.handlers.set("Accessibility.getFullAXTree", () => ({ nodes: [...buildSnapshot(page.body).ax.values()] }));
	cdp.handlers.set("Page.getLayoutMetrics", () => ({
		cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: VIEWPORT.width, clientHeight: VIEWPORT.height },
		cssContentSize: { width: VIEWPORT.pageWidth, height: VIEWPORT.pageHeight },
	}));
	cdp.handlers.set("Runtime.evaluate", () => ({ result: { value: "Example" } }));
	return cdp;
}

function newTab(): Tab {
	return {
		targetId: "T1",
		sessionId: "S1",
		url: "https://example.test/page",
		title: "Example",
		dialogs: [],
		loading: false,
		loadStarts: 0,
		elements: new Map(),
	};
}

/** Take a state of the fake page into the tab, as browser_state does. */
async function observe(cdp: CdpClient, tab: Tab): Promise<CapturedState> {
	const state = await captureState(cdp, tab.sessionId, 100_000);
	for (const [id, fingerprint] of state.tree.elements) {
		tab.elements.set(id, { ...fingerprint, loaderId: state.loaderIds.get(fingerprint.frameId) });
	}
	return state;
}

const button = (id: number, name: string, extra: Partial<FakeNode> = {}): FakeNode => ({
	id,
	tag: "button",
	role: "button",
	name,
	...extra,
});

describe("browser element resolution", () => {
	it("acts on the same element while it is alive in the same document", async () => {
		const page = { body: [button(10, "Save")], alive: new Set([10]), loaderId: "L1" };
		const cdp = fakePage(page);
		const tab = newTab();
		await observe(cdp, tab);
		cdp.calls.length = 0;
		const element = await resolveElement(cdp, tab, 10, "clicked", () => {});
		expect(element).toMatchObject({ backendNodeId: 10, objectId: "obj-10" });
		expect(element.reidentified).toBeUndefined();
		expect(cdp.methods()).not.toContain("DOMSnapshot.captureSnapshot");
	});

	it("finds a re-rendered element again by role and name", async () => {
		const page = { body: [button(10, "Save"), button(11, "Cancel")], alive: new Set([10, 11]), loaderId: "L1" };
		const cdp = fakePage(page);
		const tab = newTab();
		await observe(cdp, tab);
		// The framework replaced the Save button with a new node in a new wrapper.
		page.body = [
			{ id: 15, tag: "div", children: [button(20, "Save", { box: [0, 40, 100, 20] })] },
			button(11, "Cancel"),
		];
		page.alive = new Set([20, 11]);
		const remembered: CapturedState[] = [];
		const element = await resolveElement(cdp, tab, 10, "clicked", (state) => remembered.push(state));
		expect(element.backendNodeId).toBe(20);
		expect(element.reidentified).toEqual({ from: 10, by: "role and name" });
		expect(remembered).toHaveLength(1);
	});

	it("refuses an ambiguous match without sending any input", async () => {
		const page = { body: [button(10, "Delete")], alive: new Set([10]), loaderId: "L1" };
		const cdp = fakePage(page);
		const tab = newTab();
		await observe(cdp, tab);
		page.body = [button(20, "Delete", { box: [0, 0, 80, 20] }), button(21, "Delete", { box: [0, 40, 80, 20] })];
		page.alive = new Set([20, 21]);
		const error = await resolveElement(cdp, tab, 10, "clicked", () => {}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(BrowserActionError);
		expect((error as Error).message).toMatch(
			/^AMBIGUOUS ELEMENT HANDLE \[10\]: .*2 elements match.*nothing was clicked/,
		);
		expect(cdp.methods().some((method) => method.startsWith("Input."))).toBe(false);
	});

	it("fails with a stale handle when nothing matches", async () => {
		const page = { body: [button(10, "Submit")], alive: new Set([10]), loaderId: "L1" };
		const cdp = fakePage(page);
		const tab = newTab();
		await observe(cdp, tab);
		page.body = [button(30, "Something else")];
		page.alive = new Set([30]);
		await expect(resolveElement(cdp, tab, 10, "typed", () => {})).rejects.toThrow(
			/^STALE ELEMENT HANDLE \[10\]: the element was removed or re-rendered and no element matches it now; nothing was typed\. Take a fresh browser_state\.$/,
		);
	});

	it("does not trust a live node id after the document changed", async () => {
		const page = { body: [button(10, "Next")], alive: new Set([10]), loaderId: "L1" };
		const cdp = fakePage(page);
		const tab = newTab();
		await observe(cdp, tab);
		// A navigation reused the node id for a different element.
		page.body = [button(10, "Buy now")];
		page.loaderId = "L2";
		await expect(resolveElement(cdp, tab, 10, "clicked", () => {})).rejects.toThrow(
			/^STALE ELEMENT HANDLE \[10\]: the page loaded a new document/,
		);
	});

	it("rejects indices that were never shown", async () => {
		const cdp = fakePage({ body: [], alive: new Set(), loaderId: "L1" });
		await expect(resolveElement(cdp, newTab(), 99, "clicked", () => {})).rejects.toThrow(/^UNKNOWN ELEMENT \[99\]/);
	});

	it("does not move a stale index to the next row or to another page", () => {
		const row = (id: number, path: string, documentUrl = "https://shop.test/cart"): ElementFingerprint => ({
			backendNodeId: id,
			frameId: "main",
			tag: "button",
			role: "button",
			name: "Delete",
			attributes: {},
			path,
			documentUrl,
		});
		// Row 2's Delete was shown; row 1 was removed, so row 3's Delete now sits at li[2].
		expect(
			reidentify(row(10, "html/body/ul/li[2]/button"), [
				row(20, "html/body/ul/li[1]/button"),
				row(21, "html/body/ul/li[2]/button"),
			]),
		).toMatchObject({ level: "role and name", matches: [{ backendNodeId: 20 }, { backendNodeId: 21 }] });
		// After a navigation to another page, its only Delete button is not the one that was shown.
		expect(
			reidentify(row(10, "html/body/ul/li[2]/button"), [
				row(30, "html/body/form/button", "https://shop.test/account"),
			]),
		).toBeUndefined();
		// The same page with another hash is the same document.
		expect(
			reidentify(row(10, "html/body/ul/li[2]/button"), [
				row(31, "html/body/div/button", "https://shop.test/cart#top"),
			]),
		).toMatchObject({ level: "role and name", matches: [{ backendNodeId: 31 }] });
	});

	it("re-identifies by stable attributes but not by generated ids", () => {
		const base: ElementFingerprint = {
			backendNodeId: 1,
			frameId: "main",
			tag: "input",
			role: "textbox",
			name: "",
			attributes: { id: "mui-4821" },
			path: "html/body/input",
			documentUrl: "https://example.test/",
		};
		const fresh = [{ ...base, backendNodeId: 2, path: "html/body/div/input" }];
		expect(reidentify(base, fresh)).toBeUndefined();
		const stable = { ...base, attributes: { "data-testid": "email" } };
		expect(reidentify(stable, [{ ...stable, backendNodeId: 3, path: "x" }])).toMatchObject({
			level: 'data-testid="email"',
			matches: [{ backendNodeId: 3 }],
		});
		expect(looksGenerated(":r3:")).toBe(true);
		expect(looksGenerated("input-1234")).toBe(true);
		expect(looksGenerated("email")).toBe(false);
	});
});

describe("browser delta", () => {
	const probe: Probe = { url: "https://a.test/", title: "A", nodes: 10, digest: 5, dialogs: 0, focus: "", tabs: 1 };

	it("reports what changed", () => {
		expect(diffProbes(probe, { ...probe, url: "https://a.test/b", nodes: 12 })).toEqual({
			changes: ["url: https://a.test/b", "elements: 10 -> 12"],
			significant: true,
		});
		expect(diffProbes(probe, { ...probe, digest: 6 }).changes).toEqual(["content or layout changed"]);
	});

	it("counts focus moves only when asked", () => {
		expect(diffProbes(probe, { ...probe, focus: "input#q" }).significant).toBe(false);
		expect(diffProbes(probe, { ...probe, focus: "input#q" }, true).significant).toBe(true);
	});

	it("marks an action without measurable effect as no_effect", async () => {
		let probes = 0;
		const report = await deltaReport(probe, async () => {
			probes++;
			return { ...probe };
		});
		expect(report).toMatch(/^no_effect: true - nothing measurably changed/);
		expect(probes).toBe(4);
	});

	it("waits briefly for a late reaction", async () => {
		let probes = 0;
		const report = await deltaReport(probe, async () => (++probes >= 2 ? { ...probe, title: "B" } : { ...probe }));
		expect(report).toBe('changed: title: "B"');
	});

	it("says the effect is unknown when the page cannot be read", async () => {
		expect(await deltaReport(undefined, async () => probe)).toMatch(/^effect unknown/);
	});
});

describe("browser dialogs and tabs", () => {
	async function connected() {
		const cdp = new FakeCdp();
		cdp.handlers.set("Target.getTargets", () => ({ targetInfos: [] }));
		cdp.handlers.set("Target.createTarget", () => {
			cdp.emit("Target.targetCreated", {
				targetInfo: { targetId: "TARGET0001", type: "page", url: "about:blank", title: "" },
			});
			return { targetId: "TARGET0001" };
		});
		cdp.handlers.set("Target.attachToTarget", () => ({ sessionId: "S1" }));
		const browser = new Browser({ resolveUrl: async () => "ws://fake", connect: async () => cdp });
		const tab = await browser.newTab();
		return { cdp, browser, tab };
	}

	it("dismisses dialogs at once and reports them", async () => {
		const { cdp, tab } = await connected();
		cdp.emit("Page.javascriptDialogOpening", { type: "confirm", message: "Delete everything?" }, "S1");
		cdp.emit("Page.javascriptDialogOpening", { type: "beforeunload", message: "" }, "S1");
		const handled = cdp.calls.filter((call) => call.method === "Page.handleJavaScriptDialog");
		expect(handled.map((call) => call.params.accept)).toEqual([false, true]);
		expect(tab.dialogs).toEqual(['confirm: "Delete everything?" (dismissed)', 'beforeunload: "" (accepted)']);
	});

	it("closes a new page whose requests cannot be checked instead of running it", async () => {
		const { cdp } = await connected();
		cdp.handlers.set("Fetch.enable", (_params, sessionId) => {
			if (sessionId === "POPUP") throw new Error("Fetch domain unavailable");
			return {};
		});
		cdp.emit("Target.attachedToTarget", {
			sessionId: "POPUP",
			targetInfo: { targetId: "POPUP00002", type: "page", openerId: "TARGET0001" },
			waitingForDebugger: true,
		});
		await vi.waitFor(() => expect(cdp.methods()).toContain("Target.closeTarget"));
		const forPopup = cdp.calls.filter((call) => call.sessionId === "POPUP").map((call) => call.method);
		expect(forPopup).not.toContain("Runtime.runIfWaitingForDebugger");
		expect(cdp.calls.find((call) => call.method === "Target.closeTarget")?.params).toEqual({
			targetId: "POPUP00002",
		});
	});

	it("resumes a new page only after its requests are checked", async () => {
		const { cdp } = await connected();
		cdp.emit("Target.attachedToTarget", {
			sessionId: "POPUP",
			targetInfo: { targetId: "POPUP00002", type: "page", openerId: "TARGET0001" },
			waitingForDebugger: true,
		});
		await vi.waitFor(() =>
			expect(cdp.calls.filter((call) => call.sessionId === "POPUP").map((call) => call.method)).toEqual([
				"Fetch.enable",
				"Target.setAutoAttach",
				"Runtime.runIfWaitingForDebugger",
			]),
		);
	});

	it("leaves pages of others alone: no request checks, resumed and detached", async () => {
		const { cdp } = await connected();
		cdp.emit("Target.attachedToTarget", {
			sessionId: "USER",
			targetInfo: { targetId: "USERTAB003", type: "page" },
			waitingForDebugger: true,
		});
		await vi.waitFor(() => expect(cdp.methods()).toContain("Target.detachFromTarget"));
		expect(cdp.calls.filter((call) => call.sessionId === "USER").map((call) => call.method)).toEqual([
			"Runtime.runIfWaitingForDebugger",
		]);
		expect(cdp.methods()).not.toContain("Target.closeTarget");
		// Frames attached from a session of an owned page are checked.
		cdp.emit(
			"Target.attachedToTarget",
			{ sessionId: "FRAME", targetInfo: { targetId: "FRAME00004", type: "iframe" }, waitingForDebugger: true },
			"S1",
		);
		await vi.waitFor(() =>
			expect(cdp.calls.filter((call) => call.sessionId === "FRAME").map((call) => call.method)).toEqual([
				"Fetch.enable",
				"Target.setAutoAttach",
				"Runtime.runIfWaitingForDebugger",
			]),
		);
	});

	it("denies downloads and closes the connection when setting it up fails", async () => {
		const { cdp } = await connected();
		expect(cdp.methods()).toContain("Browser.setDownloadBehavior");
		const failing = new FakeCdp();
		failing.handlers.set("Target.getTargets", () => {
			throw new Error("boom");
		});
		const browser = new Browser({ resolveUrl: async () => "ws://fake", connect: async () => failing });
		await expect(browser.cdp()).rejects.toThrow("boom");
		expect(failing.closed).toBe(true);
	});

	it("tracks owned tabs, popups, and loading", async () => {
		const { cdp, browser, tab } = await connected();
		expect(cdp.calls.find((call) => call.method === "Target.createTarget")?.params).toEqual({
			url: "about:blank",
			background: true,
		});
		cdp.emit("Target.targetCreated", {
			targetInfo: {
				targetId: "POPUP00002",
				type: "page",
				url: "https://b.test/",
				title: "B",
				openerId: "TARGET0001",
			},
		});
		cdp.emit("Target.targetCreated", {
			targetInfo: { targetId: "OTHER00003", type: "page", url: "https://c.test/", title: "C" },
		});
		expect(browser.listTabs()).toEqual([
			{ id: "0001", title: "", url: "about:blank", current: true },
			{ id: "0002", title: "B", url: "https://b.test/", current: false },
		]);
		expect(browser.findTab("0002")).toBe("POPUP00002");
		expect(browser.findTab("0003")).toBeUndefined();
		cdp.emit("Page.frameStartedLoading", { frameId: "TARGET0001" }, "S1");
		expect(tab).toMatchObject({ loading: true, loadStarts: 1 });
		cdp.emit("Page.frameStoppedLoading", { frameId: "TARGET0001" }, "S1");
		expect(tab.loading).toBe(false);
	});
});

describe("browser input parsing and policy", () => {
	it("parses key combinations", () => {
		expect(parseKeyCombo("Enter")).toMatchObject({ definition: { key: "Enter", text: "\r" }, modifiers: 0 });
		expect(parseKeyCombo("Control+A")).toMatchObject({
			modifiers: 2,
			commands: ["selectAll"],
			definition: { code: "KeyA" },
		});
		expect(parseKeyCombo("Shift+Tab")).toMatchObject({ modifiers: 8, definition: { key: "Tab" } });
		expect(() => parseKeyCombo("Hyper+A")).toThrow(/Unknown modifier/);
		expect(() => parseKeyCombo("Banana")).toThrow(/Unknown key/);
		// Character codes of punctuation are other keys' codes: "." is 46, Delete.
		expect(parseKeyCombo(".").definition).toMatchObject({ code: "Period", keyCode: 190, text: "." });
		expect(parseKeyCombo("$").definition).toMatchObject({ keyCode: 0, text: "$" });
		expect(parseKeyCombo("7").definition).toMatchObject({ code: "Digit7", keyCode: 55 });
	});

	it("enforces allowed domains", () => {
		expect(blockedReason("https://evil.test/", [])).toBeUndefined();
		expect(blockedReason("https://docs.example.com/x", ["example.com"])).toBeUndefined();
		expect(blockedReason("https://example.com.evil.test/", ["example.com"])).toBe(
			"is outside browser.allowedDomains (example.com)",
		);
		expect(blockedReason("https://a.example.com/", ["*.example.com"])).toBeUndefined();
		expect(blockedReason("about:blank", ["example.com"])).toBeUndefined();
	});

	it("allows only http and https pages, with or without an allowlist", () => {
		for (const url of [
			"file:///etc/passwd",
			"view-source:file:///etc/passwd",
			"chrome://settings",
			"data:text/html,x",
		]) {
			expect(blockedReason(url, undefined)).toBe("is not an http or https page");
			expect(blockedReason(url, ["example.com"])).toBe("is not an http or https page");
		}
	});

	it("adds https to URLs without a scheme", () => {
		expect(normalizeUrl("example.com/a")).toBe("https://example.com/a");
		expect(normalizeUrl("http://localhost:3000")).toBe("http://localhost:3000");
	});
});
