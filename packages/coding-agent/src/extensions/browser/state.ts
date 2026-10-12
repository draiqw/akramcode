/**
 * Page state for the model: a compact text tree of interactive and meaningful elements.
 *
 * Built from `DOMSnapshot.captureSnapshot` (DOM, layout, styles, form values; includes same-process
 * iframes and open shadow roots) and `Accessibility.getFullAXTree` (roles and accessible names).
 * Elements are indexed by their `backendNodeId`, so an element keeps its index across states while
 * it lives, and an index of a destroyed element is detected instead of pointing at another one.
 * Each index also gets a fingerprint for re-identification after a re-render (see `actions.ts`).
 *
 * Output, one element or text run per line:
 *
 *   # Heading
 *   Some paragraph text
 *   [123] link "Docs" -> /docs
 *   [131] textbox "Email" type=email value="a@b.c"
 *   [140] select "Size" value="Medium" options=Small|Medium|Large
 */

import type { CdpClient } from "./cdp.ts";

// ---------------------------------------------------------------------------------------------
// CDP shapes (only the fields used here)
// ---------------------------------------------------------------------------------------------

interface RareStringData {
	index: number[];
	value: number[];
}

interface RareBooleanData {
	index: number[];
}

export interface SnapshotDocument {
	documentURL: number;
	frameId: number;
	nodes: {
		parentIndex: number[];
		nodeType: number[];
		nodeName: number[];
		nodeValue: number[];
		backendNodeId: number[];
		attributes: number[][];
		inputValue?: RareStringData;
		inputChecked?: RareBooleanData;
		optionSelected?: RareBooleanData;
		contentDocumentIndex?: { index: number[]; value: number[] };
		isClickable?: RareBooleanData;
		shadowRootType?: RareStringData;
	};
	layout: {
		nodeIndex: number[];
		styles: number[][];
		bounds: number[][];
		clientRects?: number[][];
	};
	scrollOffsetX?: number;
	scrollOffsetY?: number;
}

export interface CapturedSnapshot {
	documents: SnapshotDocument[];
	strings: string[];
}

interface AxValue {
	value?: unknown;
}

export interface AxNode {
	ignored?: boolean;
	role?: AxValue;
	name?: AxValue;
	properties?: Array<{ name: string; value: AxValue }>;
	backendDOMNodeId?: number;
}

/** Styles requested from the snapshot, in this order. */
export const SNAPSHOT_STYLES = ["display", "visibility", "opacity", "cursor"];

// ---------------------------------------------------------------------------------------------
// Model-facing state
// ---------------------------------------------------------------------------------------------

/** What is remembered about an indexed element to find it again after a re-render. */
export interface ElementFingerprint {
	backendNodeId: number;
	frameId: string;
	tag: string;
	role: string;
	name: string;
	/** Identifying attributes: id, name, data-testid, aria-label, type, href, placeholder. */
	attributes: Record<string, string>;
	/** Structural path such as `html/body/div[2]/#shadow/button`. */
	path: string;
	/** Document URL the element was seen in. */
	documentUrl: string;
	/** Loader id of that document, set when the model is shown the element. */
	loaderId?: string;
}

export interface Viewport {
	width: number;
	height: number;
	scrollX: number;
	scrollY: number;
	pageWidth: number;
	pageHeight: number;
}

export interface TreeResult {
	/** Element and text lines, already capped to the budget. */
	lines: string[];
	/** Fingerprints by index (`backendNodeId`). */
	elements: Map<number, ElementFingerprint>;
	/** Interactive elements left out because they are far outside the viewport. */
	hiddenAbove: number;
	hiddenBelow: number;
	/** Lines dropped by the budget. */
	truncatedLines: number;
}

const INTERACTIVE_ROLES = new Set([
	"button",
	"link",
	"checkbox",
	"radio",
	"textbox",
	"searchbox",
	"combobox",
	"listbox",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
	"option",
	"slider",
	"spinbutton",
	"switch",
	"tab",
	"treeitem",
]);

const IDENTIFYING_ATTRIBUTES = ["id", "name", "data-testid", "aria-label", "type", "href", "placeholder"];
const MAX_NAME = 100;
const MAX_TEXT_LINE = 300;
const MAX_HREF = 80;
const MAX_VALUE = 80;
const MAX_OPTIONS = 8;

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function quote(text: string): string {
	return `"${text.replace(/"/g, "'")}"`;
}

/** An href as the model sees it: same-origin links without origin, long ones clipped. */
export function shortenHref(href: string, pageUrl: string): string {
	let short = href;
	try {
		const url = new URL(href, pageUrl);
		const page = new URL(pageUrl);
		short =
			url.origin === page.origin && url.origin !== "null" ? `${url.pathname}${url.search}${url.hash}` : url.href;
	} catch {
		// Keep it as written.
	}
	return clip(short, MAX_HREF);
}

function axString(value: AxValue | undefined): string {
	return typeof value?.value === "string" ? value.value : "";
}

function axProperty(node: AxNode | undefined, name: string): unknown {
	return node?.properties?.find((property) => property.name === name)?.value.value;
}

/** Interactive role of a node by tag, attributes, and AX role; undefined when not interactive. */
function interactiveRole(
	tag: string,
	attrs: Record<string, string>,
	ax: AxNode | undefined,
	clickable: boolean,
	cursor: string,
): string | undefined {
	const axRole = ax && !ax.ignored ? axString(ax.role) : "";
	if (tag === "select") return "select";
	if (tag === "input") {
		const type = (attrs.type ?? "text").toLowerCase();
		if (type === "hidden") return undefined;
		if (type === "checkbox" || type === "radio") return type;
		if (["button", "submit", "reset", "image"].includes(type)) return "button";
		return axRole && INTERACTIVE_ROLES.has(axRole) ? axRole : "textbox";
	}
	if (tag === "textarea") return "textbox";
	if (INTERACTIVE_ROLES.has(axRole)) return axRole;
	if (tag === "a" && attrs.href !== undefined) return "link";
	if (tag === "button" || tag === "summary") return "button";
	const editable = attrs.contenteditable;
	if (editable !== undefined && editable !== "false") return "textbox";
	if (clickable && cursor === "pointer") return "clickable";
	return undefined;
}

interface DocContext {
	doc: SnapshotDocument;
	frameId: string;
	documentUrl: string;
	/** Offset of the document in root page coordinates. */
	offsetX: number;
	offsetY: number;
	layoutByNode: Map<number, number>;
	children: Map<number, number[]>;
	inputValue: Map<number, string>;
	checked: Set<number>;
	selected: Set<number>;
	clickable: Set<number>;
	contentDocument: Map<number, number>;
}

function rareStrings(data: RareStringData | undefined, strings: string[]): Map<number, string> {
	const map = new Map<number, string>();
	if (!data) return map;
	data.index.forEach((node, i) => {
		map.set(node, strings[data.value[i]] ?? "");
	});
	return map;
}

/**
 * Build the tree lines from a snapshot. Pure: tests feed recorded snapshots.
 *
 * @param axByBackendId AX nodes of every frame, by `backendDOMNodeId`.
 * @param viewport scroll position and size in root page coordinates.
 * @param maxChars budget for the joined lines.
 */
export function buildTree(
	snapshot: CapturedSnapshot,
	axByBackendId: Map<number, AxNode>,
	viewport: Viewport,
	pageUrl: string,
	maxChars: number,
): TreeResult {
	const { strings } = snapshot;
	const str = (index: number | undefined) => (index === undefined || index < 0 ? "" : (strings[index] ?? ""));
	const lines: string[] = [];
	const elements = new Map<number, ElementFingerprint>();
	let hiddenAbove = 0;
	let hiddenBelow = 0;
	// Elements and text far outside the viewport are left out; one viewport above and below is kept.
	const top = viewport.scrollY - viewport.height;
	const bottom = viewport.scrollY + viewport.height * 2;

	const contexts: DocContext[] = snapshot.documents.map((doc) => {
		const layoutByNode = new Map<number, number>();
		doc.layout.nodeIndex.forEach((node, layout) => {
			layoutByNode.set(node, layout);
		});
		const children = new Map<number, number[]>();
		doc.nodes.parentIndex.forEach((parent, node) => {
			if (parent < 0) return;
			const list = children.get(parent);
			if (list) list.push(node);
			else children.set(parent, [node]);
		});
		const contentDocument = new Map<number, number>();
		doc.nodes.contentDocumentIndex?.index.forEach((node, i) => {
			contentDocument.set(node, doc.nodes.contentDocumentIndex?.value[i] ?? -1);
		});
		return {
			doc,
			frameId: str(doc.frameId),
			documentUrl: str(doc.documentURL),
			offsetX: 0,
			offsetY: 0,
			layoutByNode,
			children,
			inputValue: rareStrings(doc.nodes.inputValue, strings),
			checked: new Set(doc.nodes.inputChecked?.index ?? []),
			selected: new Set(doc.nodes.optionSelected?.index ?? []),
			clickable: new Set(doc.nodes.isClickable?.index ?? []),
			contentDocument,
		};
	});

	// One line per block: its text with the elements inside it inline, in document order.
	let segments: Array<{ element: boolean; text: string; name?: string }> = [];
	let headingLevel = 0;
	const flush = () => {
		const parts: string[] = [];
		for (const segment of segments) {
			const value = segment.element ? segment.text : clip(oneLine(segment.text), MAX_TEXT_LINE);
			if (value) parts.push(value);
		}
		segments = [];
		const line = parts.join(" ");
		if (!line) return;
		const prefix = headingLevel > 0 ? `${"#".repeat(Math.min(headingLevel, 6))} ` : "";
		lines.push(`${prefix}${line}`);
	};
	const addText = (value: string) => {
		const last = segments.at(-1);
		// Text repeating the name of the element just before it (a checkbox label) adds nothing.
		if (last?.element && last.name && oneLine(value) === last.name) return;
		if (last && !last.element) last.text += value;
		else segments.push({ element: false, text: value });
	};
	const addElement = (line: string, name: string) => {
		const last = segments.at(-1);
		// Neither does a label right before its field.
		if (last && !last.element && name) {
			const text = oneLine(last.text);
			if (text === name || text.endsWith(` ${name}`)) last.text = text.slice(0, text.length - name.length);
		}
		segments.push({ element: true, text: line, name });
	};

	const attributesOf = (ctx: DocContext, node: number): Record<string, string> => {
		const raw = ctx.doc.nodes.attributes[node] ?? [];
		const attrs: Record<string, string> = {};
		for (let i = 0; i + 1 < raw.length; i += 2) attrs[str(raw[i]).toLowerCase()] = str(raw[i + 1]);
		return attrs;
	};

	const style = (ctx: DocContext, layout: number, which: number) => str(ctx.doc.layout.styles[layout]?.[which]);

	const pathOf = (ctx: DocContext, node: number): string => {
		const parts: string[] = [];
		let current = node;
		while (current >= 0) {
			const parent = ctx.doc.nodes.parentIndex[current] ?? -1;
			const type = ctx.doc.nodes.nodeType[current];
			if (type === 11) parts.push("#shadow");
			else if (type === 1) {
				const name = str(ctx.doc.nodes.nodeName[current]).toLowerCase();
				const siblings = (parent >= 0 ? ctx.children.get(parent) : undefined)?.filter(
					(sibling) => str(ctx.doc.nodes.nodeName[sibling]).toLowerCase() === name,
				);
				parts.push(siblings && siblings.length > 1 ? `${name}[${siblings.indexOf(current) + 1}]` : name);
			}
			current = parent;
		}
		return parts.reverse().join("/");
	};

	/** Text of the subtree, for names of elements the AX tree did not name. */
	const subtreeText = (ctx: DocContext, node: number, depth = 0): string => {
		if (depth > 8) return "";
		if (ctx.doc.nodes.nodeType[node] === 3) return str(ctx.doc.nodes.nodeValue[node]);
		return (ctx.children.get(node) ?? []).map((child) => subtreeText(ctx, child, depth + 1)).join(" ");
	};

	const selectOptions = (ctx: DocContext, node: number): { value: string; options: string[] } => {
		const options: string[] = [];
		let value = "";
		const visit = (current: number) => {
			for (const child of ctx.children.get(current) ?? []) {
				const tag = str(ctx.doc.nodes.nodeName[child]).toLowerCase();
				if (tag === "option") {
					const label = oneLine(subtreeText(ctx, child));
					options.push(label);
					if (ctx.selected.has(child)) value = label;
				} else if (tag === "optgroup") visit(child);
			}
		};
		visit(node);
		return { value: value || options[0] || "", options };
	};

	const describe = (
		ctx: DocContext,
		node: number,
		tag: string,
		role: string,
		attrs: Record<string, string>,
		ax: AxNode | undefined,
	): { line: string; name: string } => {
		let name = oneLine(axString(ax?.name));
		if (!name && role !== "textbox" && role !== "select") name = oneLine(subtreeText(ctx, node));
		if (!name) name = oneLine(attrs["aria-label"] ?? attrs.title ?? attrs.placeholder ?? attrs.alt ?? "");
		const parts = [`[${ctx.doc.nodes.backendNodeId[node]}]`, role];
		if (name) parts.push(quote(clip(name, MAX_NAME)));
		if (tag === "input") {
			const type = (attrs.type ?? "text").toLowerCase();
			if (!["text", "checkbox", "radio", "button", "submit"].includes(type)) parts.push(`type=${type}`);
		}
		if (role === "select") {
			const { value, options } = selectOptions(ctx, node);
			parts.push(`value=${quote(clip(value, MAX_VALUE))}`);
			const shown = options.slice(0, MAX_OPTIONS).map((option) => clip(option, 40).replace(/\|/g, "/"));
			const more = options.length > MAX_OPTIONS ? `|+${options.length - MAX_OPTIONS} more` : "";
			if (shown.length > 0) parts.push(`options=${shown.join("|")}${more}`);
		} else if (role === "textbox" || role === "searchbox" || role === "combobox" || role === "spinbutton") {
			const value = ctx.inputValue.get(node) ?? (tag === "textarea" ? oneLine(subtreeText(ctx, node)) : "");
			const type = (attrs.type ?? "").toLowerCase();
			if (value) parts.push(`value=${quote(clip(type === "password" ? "***" : oneLine(value), MAX_VALUE))}`);
			else if (attrs.placeholder && attrs.placeholder !== name)
				parts.push(`placeholder=${quote(clip(attrs.placeholder, 60))}`);
		}
		if (role === "link" && attrs.href !== undefined && !attrs.href.startsWith("javascript:")) {
			parts.push(`-> ${shortenHref(attrs.href, ctx.documentUrl || pageUrl)}`);
		}
		const axChecked = axProperty(ax, "checked");
		if (tag === "input" ? ctx.checked.has(node) : axChecked === "true" || axChecked === true) parts.push("checked");
		if (axProperty(ax, "selected") === true) parts.push("selected");
		const expanded = axProperty(ax, "expanded");
		if (expanded === true) parts.push("expanded");
		else if (expanded === false) parts.push("collapsed");
		if (axProperty(ax, "disabled") === true || attrs.disabled !== undefined) parts.push("disabled");
		return { line: parts.join(" "), name: clip(name, MAX_NAME) };
	};

	/** Whether a box is on the page horizontally and near the viewport vertically. */
	const nearViewport = (ctx: DocContext, bounds: number[] | undefined) => {
		if (!bounds) return false;
		const x = bounds[0] + ctx.offsetX;
		const y = bounds[1] + ctx.offsetY;
		return (
			x + bounds[2] > 0 && x < Math.max(viewport.pageWidth, viewport.width) && y + bounds[3] >= top && y <= bottom
		);
	};

	const visit = (ctx: DocContext, node: number, insideInteractive: boolean, hidden: boolean) => {
		const nodes = ctx.doc.nodes;
		const type = nodes.nodeType[node];
		const layout = ctx.layoutByNode.get(node);
		if (type === 3) {
			if (insideInteractive || hidden || layout === undefined) return;
			if (style(ctx, layout, 1) === "hidden" || !nearViewport(ctx, ctx.doc.layout.bounds[layout])) return;
			addText(` ${str(nodes.nodeValue[node])}`);
			return;
		}
		if (type !== 1 && type !== 9 && type !== 11) return;
		const tag = type === 1 ? str(nodes.nodeName[node]).toLowerCase() : "";
		if (["script", "style", "noscript", "template", "head", "option", "optgroup"].includes(tag)) return;
		// A line break ends the line, so links separated by <br> do not become one huge line.
		if (tag === "br") {
			flush();
			return;
		}

		let display = "contents";
		let interactive = false;
		let heading = 0;
		let childrenHidden = hidden;
		if (type === 1) {
			if (layout !== undefined) {
				display = style(ctx, layout, 0);
				// Opacity is not inherited, so a transparent ancestor hides its subtree here.
				if (style(ctx, layout, 2) === "0") childrenHidden = true;
				// Transparent checkboxes and radios sit on top of their custom-drawn replacements.
				const transparentControl =
					tag === "input" && ["checkbox", "radio"].includes((attributesOf(ctx, node).type ?? "").toLowerCase());
				const visible = !hidden && style(ctx, layout, 1) !== "hidden" && (!childrenHidden || transparentControl);
				const bounds = ctx.doc.layout.bounds[layout] ?? [0, 0, 0, 0];
				const [y, width, height] = [bounds[1] + ctx.offsetY, bounds[2], bounds[3]];
				const backendNodeId = nodes.backendNodeId[node];
				const ax = axByBackendId.get(backendNodeId);
				const attrs = attributesOf(ctx, node);
				const role = interactiveRole(tag, attrs, ax, ctx.clickable.has(node), style(ctx, layout, 3));
				if (role && visible && width > 0 && height > 0) {
					if (y + height < top) hiddenAbove++;
					else if (y > bottom) hiddenBelow++;
					else if (nearViewport(ctx, bounds)) {
						const described = describe(ctx, node, tag, role, attrs, ax);
						addElement(described.line, described.name);
						interactive = true;
						const fingerprintAttrs: Record<string, string> = {};
						for (const key of IDENTIFYING_ATTRIBUTES) {
							if (attrs[key] !== undefined) fingerprintAttrs[key] = attrs[key];
						}
						elements.set(backendNodeId, {
							backendNodeId,
							frameId: ctx.frameId,
							tag,
							role,
							name: oneLine(axString(ax?.name)),
							attributes: fingerprintAttrs,
							path: pathOf(ctx, node),
							documentUrl: ctx.documentUrl,
						});
					}
				}
				if (axString(ax?.role) === "heading" && !insideInteractive) {
					const level = axProperty(ax, "level");
					heading = typeof level === "number" ? level : 2;
				}
			}
			const childDoc = ctx.contentDocument.get(node);
			if (childDoc !== undefined && contexts[childDoc] && layout !== undefined) {
				const child = contexts[childDoc];
				const bounds = ctx.doc.layout.bounds[layout] ?? [0, 0];
				const client = ctx.doc.layout.clientRects?.[layout] ?? [];
				child.offsetX = ctx.offsetX + bounds[0] + (client[0] ?? 0);
				child.offsetY = ctx.offsetY + bounds[1] + (client[1] ?? 0);
				flush();
				visit(child, 0, insideInteractive, childrenHidden);
				flush();
				return;
			}
		}
		// Table cells stay on their row's line.
		const block = !display.startsWith("inline") && display !== "contents" && display !== "table-cell";
		if (block || heading) flush();
		else if (display === "table-cell") addText(" ");
		const outerHeading = headingLevel;
		if (heading) headingLevel = heading;
		for (const child of ctx.children.get(node) ?? [])
			visit(ctx, child, insideInteractive || interactive, childrenHidden);
		if (block || heading) flush();
		headingLevel = outerHeading;
	};

	if (contexts[0]) visit(contexts[0], 0, false, false);
	flush();

	const kept: string[] = [];
	let used = 0;
	let cut = false;
	for (const line of lines) {
		if (used + line.length + 1 > maxChars) {
			// Cut the line that does not fit rather than dropping it, so one long line cannot empty the state.
			const room = maxChars - used - 2;
			if (room >= 20) {
				kept.push(`${line.slice(0, room)}…`);
				cut = true;
			}
			break;
		}
		kept.push(line);
		used += line.length + 1;
	}
	const truncatedLines = lines.length - kept.length + (cut ? 1 : 0);
	// Fingerprints only for elements the model can see.
	const shown = new Set(kept.flatMap((line) => [...line.matchAll(/\[(\d+)\] /g)].map((match) => Number(match[1]))));
	for (const id of elements.keys()) if (!shown.has(id)) elements.delete(id);
	return { lines: kept, elements, hiddenAbove, hiddenBelow, truncatedLines };
}

// ---------------------------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------------------------

export interface LayoutMetrics {
	cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
	cssContentSize: { width: number; height: number };
}

export interface FrameTree {
	frame: { id: string; loaderId: string; url: string };
	childFrames?: FrameTree[];
}

export interface CapturedState {
	url: string;
	title: string;
	viewport: Viewport;
	tree: TreeResult;
	/** Loader id of each frame when the state was taken; a different one means a new document. */
	loaderIds: Map<string, string>;
}

export function collectLoaderIds(tree: FrameTree, into = new Map<string, string>()): Map<string, string> {
	into.set(tree.frame.id, tree.frame.loaderId);
	for (const child of tree.childFrames ?? []) collectLoaderIds(child, into);
	return into;
}

/** Take the state of the page attached as `sessionId`. */
export async function captureState(cdp: CdpClient, sessionId: string, maxChars: number): Promise<CapturedState> {
	const [snapshot, metrics, frames, title] = await Promise.all([
		cdp.send<CapturedSnapshot>(
			"DOMSnapshot.captureSnapshot",
			{ computedStyles: SNAPSHOT_STYLES, includeDOMRects: true },
			sessionId,
		),
		cdp.send<LayoutMetrics>("Page.getLayoutMetrics", {}, sessionId),
		cdp.send<{ frameTree: FrameTree }>("Page.getFrameTree", {}, sessionId),
		cdp.send<{ result: { value?: unknown } }>(
			"Runtime.evaluate",
			{ expression: "document.title", returnByValue: true },
			sessionId,
		),
	]);
	const axByBackendId = new Map<number, AxNode>();
	const frameIds = snapshot.documents.map((doc) => snapshot.strings[doc.frameId]).filter(Boolean);
	await Promise.all(
		frameIds.map(async (frameId, i) => {
			try {
				const { nodes } = await cdp.send<{ nodes: AxNode[] }>(
					"Accessibility.getFullAXTree",
					i === 0 ? {} : { frameId },
					sessionId,
				);
				for (const node of nodes) {
					if (node.backendDOMNodeId !== undefined) axByBackendId.set(node.backendDOMNodeId, node);
				}
			} catch {
				// Frames without an AX tree fall back to tags and attributes.
			}
		}),
	);
	const visual = metrics.cssVisualViewport;
	const viewport: Viewport = {
		width: Math.round(visual.clientWidth),
		height: Math.round(visual.clientHeight),
		scrollX: Math.round(visual.pageX),
		scrollY: Math.round(visual.pageY),
		pageWidth: Math.round(metrics.cssContentSize.width),
		pageHeight: Math.round(metrics.cssContentSize.height),
	};
	const url = frames.frameTree.frame.url;
	return {
		url,
		title: typeof title.result.value === "string" ? title.result.value : "",
		viewport,
		tree: buildTree(snapshot, axByBackendId, viewport, url, maxChars),
		loaderIds: collectLoaderIds(frames.frameTree),
	};
}

export interface TabSummary {
	id: string;
	title: string;
	url: string;
	current: boolean;
}

/** The text the model gets for a state. */
export function formatState(state: CapturedState, tabs: TabSummary[], dialogs: string[]): string {
	const { viewport, tree } = state;
	const above = viewport.height > 0 ? viewport.scrollY / viewport.height : 0;
	const below =
		viewport.height > 0 ? Math.max(0, viewport.pageHeight - viewport.scrollY - viewport.height) / viewport.height : 0;
	const header = [`url: ${state.url}`, `title: ${clip(oneLine(state.title), 150)}`];
	if (tabs.length > 0) {
		header.push(
			`tabs: ${tabs.map((tab) => `${tab.id}${tab.current ? "*" : ""} ${quote(clip(oneLine(tab.title || tab.url), 40))}`).join(", ")}`,
		);
	}
	header.push(
		`viewport: ${viewport.width}x${viewport.height}, scroll ${viewport.scrollX},${viewport.scrollY}, ${above.toFixed(1)} pages above, ${below.toFixed(1)} below`,
	);
	for (const dialog of dialogs) header.push(`dialog: ${dialog}`);
	const body = [...tree.lines];
	if (tree.hiddenAbove > 0) body.unshift(`(${tree.hiddenAbove} interactive elements further up - scroll up)`);
	if (tree.hiddenBelow > 0) body.push(`(${tree.hiddenBelow} interactive elements further down - scroll down)`);
	if (tree.truncatedLines > 0) body.push(`(truncated: ${tree.truncatedLines} more lines - raise max_chars or scroll)`);
	if (tree.lines.length === 0) body.push("(no visible content)");
	return `${header.join("\n")}\n\n${body.join("\n")}`;
}
