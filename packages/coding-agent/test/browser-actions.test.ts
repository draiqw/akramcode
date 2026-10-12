import { describe, expect, it } from "vitest";
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
import { Browser, isAllowedUrl, type Tab } from "../src/extensions/browser/browser.ts";
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
	});

	it("enforces allowed domains", () => {
		expect(isAllowedUrl("https://evil.test/", [])).toBe(true);
		expect(isAllowedUrl("https://docs.example.com/x", ["example.com"])).toBe(true);
		expect(isAllowedUrl("https://example.com.evil.test/", ["example.com"])).toBe(false);
		expect(isAllowedUrl("https://a.example.com/", ["*.example.com"])).toBe(true);
		expect(isAllowedUrl("about:blank", ["example.com"])).toBe(true);
		expect(isAllowedUrl("file:///etc/passwd", ["example.com"])).toBe(false);
	});

	it("adds https to URLs without a scheme", () => {
		expect(normalizeUrl("example.com/a")).toBe("https://example.com/a");
		expect(normalizeUrl("http://localhost:3000")).toBe("http://localhost:3000");
	});
});
