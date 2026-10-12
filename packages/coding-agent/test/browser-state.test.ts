import { describe, expect, it } from "vitest";
import { buildTree, formatState, shortenHref } from "../src/extensions/browser/state.ts";
import { buildSnapshot, VIEWPORT } from "./browser-fixtures.ts";

function tree(body: Parameters<typeof buildSnapshot>[0], maxChars = 10_000, viewport = VIEWPORT) {
	const { snapshot, ax } = buildSnapshot(body);
	return buildTree(snapshot, ax, viewport, "https://example.test/page", maxChars);
}

describe("browser state", () => {
	it("serializes text and interactive elements with backendNodeId indices", () => {
		const result = tree([
			{
				id: 10,
				tag: "h1",
				role: "heading",
				name: "Title",
				axProps: { level: 1 },
				children: [{ id: 11, text: "Title" }],
			},
			{
				id: 20,
				tag: "p",
				children: [
					{ id: 21, text: "Read the " },
					{
						id: 22,
						tag: "a",
						display: "inline",
						attrs: { href: "/docs?x=1" },
						role: "link",
						name: "docs",
						children: [{ id: 23, text: "docs" }],
					},
					{ id: 24, text: " first." },
				],
			},
			{ id: 30, tag: "button", role: "button", name: "Save", children: [{ id: 31, text: "Save" }] },
		]);
		expect(result.lines).toEqual(["# Title", 'Read the [22] link "docs" -> /docs?x=1 first.', '[30] button "Save"']);
		expect([...result.elements.keys()]).toEqual([22, 30]);
		expect(result.elements.get(22)).toMatchObject({
			tag: "a",
			role: "link",
			name: "docs",
			attributes: { href: "/docs?x=1" },
			path: "html/body/p/a",
			frameId: "main",
		});
	});

	it("drops a label repeating the field name and shows form values", () => {
		const result = tree([
			{
				id: 40,
				tag: "label",
				children: [
					{ id: 41, text: "Customer name:" },
					{ id: 42, tag: "input", display: "inline-block", role: "textbox", name: "Customer name:", value: "Ann" },
				],
			},
			{
				id: 50,
				tag: "label",
				children: [
					{
						id: 51,
						tag: "input",
						display: "inline-block",
						attrs: { type: "checkbox" },
						role: "checkbox",
						name: "Bacon",
						checked: true,
					},
					{ id: 52, text: "Bacon" },
				],
			},
			{
				id: 60,
				tag: "select",
				role: "combobox",
				name: "Size",
				children: [
					{ id: 61, tag: "option", children: [{ id: 62, text: "Small" }] },
					{ id: 63, tag: "option", selected: true, children: [{ id: 64, text: "Medium" }] },
				],
			},
			{ id: 70, tag: "input", attrs: { type: "password" }, role: "textbox", name: "Password", value: "hunter2" },
			{ id: 80, tag: "input", attrs: { type: "hidden" }, value: "secret" },
		]);
		expect(result.lines).toEqual([
			'[42] textbox "Customer name:" value="Ann"',
			'[51] checkbox "Bacon" checked',
			'[60] select "Size" value="Medium" options=Small|Medium',
			'[70] textbox "Password" type=password value="***"',
		]);
	});

	it("leaves out hidden, transparent, and undisplayed content but keeps transparent checkboxes", () => {
		const result = tree([
			{ id: 10, tag: "button", role: "button", name: "Hidden", visibility: "hidden" },
			{ id: 20, tag: "div", opacity: "0", children: [{ id: 21, text: "ghost" }] },
			{ id: 30, tag: "div", noLayout: true, children: [{ id: 31, text: "none", noLayout: true }] },
			{ id: 40, tag: "input", attrs: { type: "radio" }, opacity: "0", role: "radio", name: "Small" },
			{ id: 50, tag: "a", attrs: { href: "/x" }, box: [-9999, 500, 50, 20], role: "link", name: "Skip" },
		]);
		expect(result.lines).toEqual(['[40] radio "Small"']);
	});

	it("includes open shadow roots and iframes, and counts elements far below the viewport", () => {
		const result = tree([
			{
				id: 10,
				tag: "my-widget",
				shadow: true,
				children: [{ id: 11, tag: "button", role: "button", name: "Inside" }],
			},
			{
				id: 20,
				tag: "iframe",
				box: [0, 300, 300, 150],
				frame: [{ id: 21, tag: "button", box: [0, 10, 80, 20], role: "button", name: "Framed" }],
			},
			{ id: 30, tag: "button", box: [0, 5000, 80, 20], role: "button", name: "Far" },
		]);
		expect(result.lines).toEqual(['[11] button "Inside"', '[21] button "Framed"']);
		expect(result.elements.get(11)?.path).toBe("html/body/my-widget/#shadow/button");
		expect(result.elements.get(21)?.frameId).toBe("frame-20");
		expect(result.hiddenBelow).toBe(1);
	});

	it("treats clickable elements with a pointer cursor as interactive", () => {
		const result = tree([
			{ id: 10, tag: "div", clickable: true, cursor: "pointer", children: [{ id: 11, text: "Open menu" }] },
			{ id: 20, tag: "div", clickable: true, children: [{ id: 21, text: "Plain" }] },
		]);
		expect(result.lines).toEqual(['[10] clickable "Open menu"', "Plain"]);
	});

	it("caps the output and keeps fingerprints only for shown elements", () => {
		const body = Array.from({ length: 20 }, (_, i) => ({
			id: 100 + i,
			tag: "button",
			box: [0, i * 30, 80, 20] as [number, number, number, number],
			role: "button",
			name: `Button ${i}`,
		}));
		const result = tree(body, 75);
		expect(result.lines).toEqual(['[100] button "Button 0"', '[101] button "Button 1"', '[102] button "Button 2"']);
		expect(result.truncatedLines).toBe(17);
		expect([...result.elements.keys()]).toEqual([100, 101, 102]);
	});

	it("formats the header with scroll position, tabs, dialogs, and markers", () => {
		const result = tree([{ id: 10, tag: "button", role: "button", name: "Go" }]);
		const text = formatState(
			{
				url: "https://example.test/page",
				title: "Example",
				viewport: { ...VIEWPORT, scrollY: 800, pageHeight: 4000 },
				tree: { ...result, hiddenBelow: 3, truncatedLines: 2 },
				loaderIds: new Map(),
			},
			[
				{ id: "ab12", title: "Example", url: "https://example.test/page", current: true },
				{ id: "cd34", title: "Other", url: "https://other.test/", current: false },
			],
			['alert: "Saved" (dismissed)'],
		);
		expect(text).toBe(
			[
				"url: https://example.test/page",
				"title: Example",
				'tabs: ab12* "Example", cd34 "Other"',
				"viewport: 1280x800, scroll 0,800, 1.0 pages above, 3.0 below",
				'dialog: alert: "Saved" (dismissed)',
				"",
				'[10] button "Go"',
				"(3 interactive elements further down - scroll down)",
				"(truncated: 2 more lines - raise max_chars or scroll)",
			].join("\n"),
		);
	});

	it("shortens hrefs", () => {
		expect(shortenHref("https://example.test/a/b?c=1#d", "https://example.test/x")).toBe("/a/b?c=1#d");
		expect(shortenHref("https://other.test/a", "https://example.test/x")).toBe("https://other.test/a");
		expect(shortenHref(`/${"x".repeat(200)}`, "https://example.test/").length).toBe(80);
	});
});
