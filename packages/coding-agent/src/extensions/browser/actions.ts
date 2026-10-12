/**
 * Browser actions over CDP: element resolution with stale-handle checks, real input events, and a
 * delta of what each state-changing action measurably changed.
 */

import type { Tab } from "./browser.ts";
import type { CdpClient } from "./cdp.ts";
import {
	type CapturedState,
	captureState,
	collectLoaderIds,
	type ElementFingerprint,
	type FrameTree,
} from "./state.ts";

export class BrowserActionError extends Error {}

// ---------------------------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------------------------

interface RemoteResult {
	result: { value?: unknown; objectId?: string };
	exceptionDetails?: { text?: string; exception?: { description?: string } };
}

function exceptionText(details: RemoteResult["exceptionDetails"]): string {
	return details?.exception?.description ?? details?.text ?? "script failed";
}

/** Evaluate an internal expression in the page's main frame and return its JSON value. */
export async function evaluate<T>(
	cdp: CdpClient,
	sessionId: string,
	expression: string,
	timeoutMs = 10_000,
): Promise<T> {
	const response = await cdp.send<RemoteResult>(
		"Runtime.evaluate",
		{ expression, returnByValue: true, awaitPromise: true },
		sessionId,
		timeoutMs,
	);
	if (response.exceptionDetails) throw new Error(exceptionText(response.exceptionDetails));
	return response.result.value as T;
}

/** Call an internal function with `this` bound to a remote object. */
export async function callOn<T>(
	cdp: CdpClient,
	sessionId: string,
	objectId: string,
	functionDeclaration: string,
	args: unknown[] = [],
): Promise<T> {
	const response = await cdp.send<RemoteResult>(
		"Runtime.callFunctionOn",
		{
			objectId,
			functionDeclaration,
			arguments: args.map((value) => ({ value })),
			returnByValue: true,
			awaitPromise: true,
		},
		sessionId,
	);
	if (response.exceptionDetails) throw new Error(exceptionText(response.exceptionDetails));
	return response.result.value as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// Element resolution
// ---------------------------------------------------------------------------------------------

export interface ResolvedElement {
	backendNodeId: number;
	objectId: string;
	fingerprint: ElementFingerprint;
	/** Set when the element was found again under a new index. */
	reidentified?: { from: number; by: string };
}

/** Values frameworks generate (`mui-4821`, `:r3:`, hashes); matching on them is not identity. */
export function looksGenerated(value: string): boolean {
	const v = value.trim();
	if (!v) return true;
	if (/^:.*:$/.test(v) || /^_ng(content|host)/.test(v)) return true;
	if (/^[0-9a-f]{8,}$/i.test(v) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)) return true;
	if (/^(mui|css|sc|jss|emotion|chakra|radix|headlessui|ember|ext|rc|tw|ng)[-_:]?[a-z]?[0-9a-f]{2,}$/i.test(v))
		return true;
	return v
		.split(/[-_:.]/)
		.some(
			(part) =>
				/^[a-z]{0,6}[0-9]{3,}$/i.test(part) || (part.length >= 6 && /^[0-9a-f]+$/i.test(part) && /\d/.test(part)),
		);
}

const EDITABLE_TAGS = new Set(["input", "textarea"]);
const EDITABLE_ROLES = new Set(["textbox", "searchbox", "combobox"]);

function tagCompatible(a: ElementFingerprint, b: ElementFingerprint): boolean {
	if (a.tag === b.tag) return true;
	// The same text field can render as <textarea> or a contenteditable <div>.
	const editable = (f: ElementFingerprint) => EDITABLE_TAGS.has(f.tag) || EDITABLE_ROLES.has(f.role);
	return editable(a) && editable(b);
}

/**
 * Candidates for a stale fingerprint in a fresh state, level by level. The first level with
 * candidates decides: one candidate is the element, several are ambiguous.
 */
export function reidentify(
	old: ElementFingerprint,
	fresh: Iterable<ElementFingerprint>,
): { level: string; matches: ElementFingerprint[] } | undefined {
	const candidates = [...fresh];
	const levels: Array<[string, (candidate: ElementFingerprint) => boolean]> = [
		[
			"position and name",
			(c) => c.path === old.path && c.tag === old.tag && c.name === old.name && c.documentUrl === old.documentUrl,
		],
		["role and name", (c) => old.name !== "" && c.role === old.role && c.name === old.name && tagCompatible(c, old)],
	];
	for (const key of ["data-testid", "id", "name", "aria-label"]) {
		const value = old.attributes[key];
		if (!value || ((key === "id" || key === "name") && looksGenerated(value))) continue;
		levels.push([
			`${key}=${JSON.stringify(value)}`,
			(c) =>
				c.attributes[key] === value && (key === "id" || key === "name" ? c.tag === old.tag : tagCompatible(c, old)),
		]);
	}
	for (const [level, test] of levels) {
		const matches = candidates.filter(test);
		if (matches.length > 0) return { level, matches };
	}
	return undefined;
}

function describeFingerprint(f: ElementFingerprint): string {
	return `[${f.backendNodeId}] ${f.role}${f.name ? ` "${f.name.slice(0, 40)}"` : ""}`;
}

/** Live remote object of a node, or undefined when the node is gone or detached. */
async function liveObject(cdp: CdpClient, sessionId: string, backendNodeId: number): Promise<string | undefined> {
	try {
		const { object } = await cdp.send<{ object: { objectId?: string } }>(
			"DOM.resolveNode",
			{ backendNodeId },
			sessionId,
			5000,
		);
		if (!object.objectId) return undefined;
		const connected = await callOn<boolean>(
			cdp,
			sessionId,
			object.objectId,
			"function() { return this.isConnected; }",
		);
		return connected ? object.objectId : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The live element behind an index. Verifies that the node still exists in the same document;
 * otherwise finds it again by its fingerprint in a fresh state. Never acts on a guess: no match is
 * a STALE error, several matches an AMBIGUOUS error.
 *
 * @param remember stores the fingerprints of the fresh state taken for re-identification.
 */
export async function resolveElement(
	cdp: CdpClient,
	tab: Tab,
	index: number,
	verb: string,
	remember: (state: CapturedState) => void,
): Promise<ResolvedElement> {
	const fingerprint = tab.elements.get(index);
	const nothing = `nothing was ${verb}`;
	if (!fingerprint) {
		throw new BrowserActionError(
			`UNKNOWN ELEMENT [${index}]: no element with this index was shown for this tab; ${nothing}. Take a fresh browser_state and use an index from it.`,
		);
	}
	const { frameTree } = await cdp.send<{ frameTree: FrameTree }>("Page.getFrameTree", {}, tab.sessionId);
	const loaderIds = collectLoaderIds(frameTree);
	const sameDocument =
		fingerprint.loaderId !== undefined && loaderIds.get(fingerprint.frameId) === fingerprint.loaderId;
	if (sameDocument) {
		const objectId = await liveObject(cdp, tab.sessionId, index);
		if (objectId) return { backendNodeId: index, objectId, fingerprint };
	}

	const fresh = await captureState(cdp, tab.sessionId, 1_000_000);
	remember(fresh);
	const found = reidentify(fingerprint, fresh.tree.elements.values());
	const reason = sameDocument ? "the element was removed or re-rendered" : "the page loaded a new document";
	if (!found) {
		throw new BrowserActionError(
			`STALE ELEMENT HANDLE [${index}]: ${reason} and no element matches it now; ${nothing}. Take a fresh browser_state.`,
		);
	}
	if (found.matches.length > 1) {
		const listing = found.matches.slice(0, 5).map(describeFingerprint).join("; ");
		throw new BrowserActionError(
			`AMBIGUOUS ELEMENT HANDLE [${index}]: ${reason}; ${found.matches.length} elements match by ${found.level} (${listing}); ${nothing}. Take a fresh browser_state and pick one.`,
		);
	}
	const match = found.matches[0];
	const objectId = await liveObject(cdp, tab.sessionId, match.backendNodeId);
	if (!objectId) {
		throw new BrowserActionError(
			`STALE ELEMENT HANDLE [${index}]: ${reason}; ${nothing}. Take a fresh browser_state.`,
		);
	}
	return {
		backendNodeId: match.backendNodeId,
		objectId,
		fingerprint: match,
		reidentified: { from: index, by: found.level },
	};
}

// ---------------------------------------------------------------------------------------------
// Delta
// ---------------------------------------------------------------------------------------------

/** One cheap snapshot of page features; changes in the significant ones mean the page reacted. */
export const DELTA_PROBE = `(() => {
  const docs = [document];
  for (let i = 0; i < window.frames.length; i++) {
    try { if (window.frames[i].document) docs.push(window.frames[i].document); } catch (e) {}
  }
  let nodes = 0, digest = 0, i = 0;
  for (const doc of docs) {
    const all = doc.getElementsByTagName('*');
    nodes += all.length;
    const n = Math.min(all.length, 20000);
    for (let k = 0; k < n; k++, i++) {
      const el = all[k];
      const w = el.offsetWidth | 0, h = el.offsetHeight | 0;
      let v = el.tagName.length * 131 + el.tagName.charCodeAt(0);
      if (w || h) v += (el.offsetLeft | 0) * 3 + (el.offsetTop | 0) * 5 + w * 11 + h * 13;
      if (typeof el.className === 'string') v += el.className.length * 17;
      if (typeof el.value === 'string') { const s = el.value; v += s.length * 19 + (s.charCodeAt(0) | 0) * 3 + (s.charCodeAt(s.length - 1) | 0) * 7; }
      if (typeof el.selectedIndex === 'number') v += (el.selectedIndex + 2) * 43;
      if (el.checked) v += 23;
      if (el.open) v += 31;
      const ae = el.getAttribute('aria-expanded'); if (ae) v += ae === 'true' ? 37 : 41;
      if (el.childElementCount === 0) { const t = el.textContent || ''; v += t.length * 53 + (t.charCodeAt(0) | 0); }
      digest = (digest + (i + 1) * (v | 0)) % 2147483647;
    }
  }
  let a = document.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  return {
    url: location.href,
    title: document.title || '',
    nodes,
    digest,
    dialogs: document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog]').length,
    focus: a && a !== document.body ? a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') + (a.getAttribute('aria-label') ? '[' + a.getAttribute('aria-label').slice(0, 40) + ']' : '') : '',
  };
})()`;

export interface Probe {
	url: string;
	title: string;
	nodes: number;
	digest: number;
	dialogs: number;
	focus: string;
	tabs: number;
}

/**
 * What changed between two probes. `focus` alone counts only when `focusCounts` (keys such as
 * Tab move focus and nothing else); for clicks it changes whether or not a handler ran.
 */
export function diffProbes(
	before: Probe,
	after: Probe,
	focusCounts = false,
): { changes: string[]; significant: boolean } {
	const changes: string[] = [];
	let significant = false;
	if (before.url !== after.url) {
		changes.push(`url: ${after.url}`);
		significant = true;
	}
	if (before.title !== after.title) {
		changes.push(`title: ${JSON.stringify(after.title.slice(0, 100))}`);
		significant = true;
	}
	if (before.tabs !== after.tabs) {
		changes.push(`tabs: ${before.tabs} -> ${after.tabs}`);
		significant = true;
	}
	if (before.dialogs !== after.dialogs) {
		changes.push(`open dialogs: ${before.dialogs} -> ${after.dialogs}`);
		significant = true;
	}
	if (before.nodes !== after.nodes) {
		changes.push(`elements: ${before.nodes} -> ${after.nodes}`);
		significant = true;
	} else if (before.digest !== after.digest) {
		changes.push("content or layout changed");
		significant = true;
	}
	if (before.focus !== after.focus) {
		changes.push(`focus: ${after.focus || "none"}`);
		if (focusCounts) significant = true;
	}
	return { changes, significant };
}

export async function probe(cdp: CdpClient, tab: Tab, tabs: number): Promise<Probe | undefined> {
	try {
		const value = await evaluate<Omit<Probe, "tabs">>(cdp, tab.sessionId, DELTA_PROBE, 3000);
		return value && typeof value === "object" ? { ...value, tabs } : undefined;
	} catch {
		return undefined;
	}
}

/** The delta report of an action, rechecking a little while when nothing changed yet. */
export async function deltaReport(
	before: Probe | undefined,
	takeAfter: () => Promise<Probe | undefined>,
	focusCounts = false,
): Promise<string> {
	let after = await takeAfter();
	if (!before || !after) {
		return "effect unknown: the page could not be read before or after the action. Do not repeat it blindly; check browser_state first.";
	}
	let diff = diffProbes(before, after, focusCounts);
	for (let attempt = 0; attempt < 3 && !diff.significant; attempt++) {
		await sleep(150);
		const fresh = await takeAfter();
		if (!fresh) break;
		after = fresh;
		diff = diffProbes(before, after, focusCounts);
	}
	if (!diff.significant) {
		return "no_effect: true - nothing measurably changed (same url, title, elements, form values). The action may have been swallowed by an overlay, validation, or a disabled control; do not treat this step as done without checking browser_state.";
	}
	return `changed: ${diff.changes.join("; ")}`;
}

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

/** Wait until the DOM stops changing for a moment, at most `capMs`. */
export async function settle(cdp: CdpClient, tab: Tab, capMs = 1500): Promise<void> {
	const expression = `new Promise((resolve) => {
  const start = Date.now();
  let last = Date.now();
  const observer = new MutationObserver(() => { last = Date.now(); });
  try { observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); } catch (e) { resolve(false); return; }
  const tick = () => {
    if (Date.now() - last >= 300 || Date.now() - start >= ${capMs}) { observer.disconnect(); resolve(true); }
    else setTimeout(tick, 50);
  };
  setTimeout(tick, 50);
})`;
	try {
		await evaluate(cdp, tab.sessionId, expression, capMs + 2000);
	} catch {
		// A navigation can destroy the context mid-wait; the caller reads the page afterwards anyway.
	}
}

/** Wait for a load started by an action (or by navigate), then for the DOM to settle. */
export async function waitForLoad(
	cdp: CdpClient,
	tab: Tab,
	loadStartsBefore: number,
	timeoutMs: number,
): Promise<boolean> {
	// Give a click a moment to start a navigation.
	await sleep(150);
	let complete = true;
	if (tab.loadStarts !== loadStartsBefore || tab.loading) {
		const deadline = Date.now() + timeoutMs;
		while (tab.loading && Date.now() < deadline) await sleep(100);
		complete = !tab.loading;
	}
	await settle(cdp, tab);
	return complete;
}

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

/** Point to click: the center of the element's first box, checked for elements covering it. */
async function clickPoint(
	cdp: CdpClient,
	tab: Tab,
	element: ResolvedElement,
	verb: string,
): Promise<{ x: number; y: number }> {
	await cdp
		.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: element.backendNodeId }, tab.sessionId)
		.catch(() => {});
	let quads: number[][] = [];
	try {
		({ quads } = await cdp.send<{ quads: number[][] }>(
			"DOM.getContentQuads",
			{ backendNodeId: element.backendNodeId },
			tab.sessionId,
		));
	} catch {
		quads = [];
	}
	const quad = quads.find((q) => Math.hypot(q[2] - q[0], q[3] - q[1]) * Math.hypot(q[6] - q[0], q[7] - q[1]) > 1);
	if (!quad) {
		throw new BrowserActionError(
			`ELEMENT NOT VISIBLE [${element.backendNodeId}]: it has no size on the page; nothing was ${verb}. Take a fresh browser_state.`,
		);
	}
	const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
	const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
	const covering = await callOn<string>(
		cdp,
		tab.sessionId,
		element.objectId,
		`function() {
  const rect = this.getClientRects()[0] || this.getBoundingClientRect();
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  let root = this.ownerDocument, hit = root.elementFromPoint(x, y);
  while (hit && hit.shadowRoot) { const inner = hit.shadowRoot.elementFromPoint(x, y); if (!inner || inner === hit) break; hit = inner; }
  if (!hit) return '';
  if (hit === this || this.contains(hit) || (hit.getRootNode && hit.getRootNode().host && this.contains(hit.getRootNode().host))) return '';
  if (hit.tagName === 'LABEL' && hit.control === this) return '';
  if (this.labels && Array.from(this.labels).some((label) => label.contains(hit))) return '';
  let host = this.getRootNode && this.getRootNode().host;
  while (host) { if (host === hit) return ''; host = host.getRootNode && host.getRootNode().host; }
  const text = (hit.innerText || hit.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
  return '<' + hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') + (typeof hit.className === 'string' && hit.className ? '.' + hit.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') + '>' + (text ? ' "' + text + '"' : '');
}`,
	).catch(() => "");
	if (covering) {
		throw new BrowserActionError(
			`ELEMENT COVERED [${element.backendNodeId}]: ${covering} is on top of it; nothing was ${verb}. Close or scroll past the covering element (cookie banner, modal, sticky header) and retry.`,
		);
	}
	return { x, y };
}

export async function clickElement(cdp: CdpClient, tab: Tab, element: ResolvedElement): Promise<void> {
	const { x, y } = await clickPoint(cdp, tab, element, "clicked");
	const send = (type: string, extra: object = {}) =>
		cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", ...extra }, tab.sessionId);
	await send("mouseMoved", { button: "none" });
	await send("mousePressed", { clickCount: 1, buttons: 1 });
	await send("mouseReleased", { clickCount: 1, buttons: 0 });
}

export async function hoverElement(cdp: CdpClient, tab: Tab, element: ResolvedElement): Promise<void> {
	const { x, y } = await clickPoint(cdp, tab, element, "hovered");
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" }, tab.sessionId);
}

interface KeyDefinition {
	key: string;
	code: string;
	keyCode: number;
	text?: string;
}

const KEYS: Record<string, KeyDefinition> = {
	enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
	escape: { key: "Escape", code: "Escape", keyCode: 27 },
	tab: { key: "Tab", code: "Tab", keyCode: 9 },
	backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
	delete: { key: "Delete", code: "Delete", keyCode: 46 },
	space: { key: " ", code: "Space", keyCode: 32, text: " " },
	arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
	arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
	arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
	arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
	home: { key: "Home", code: "Home", keyCode: 36 },
	end: { key: "End", code: "End", keyCode: 35 },
	pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
	pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
};
const KEY_ALIASES: Record<string, string> = {
	esc: "escape",
	return: "enter",
	up: "arrowup",
	down: "arrowdown",
	left: "arrowleft",
	right: "arrowright",
};
const MODIFIERS: Record<string, number> = {
	alt: 1,
	option: 1,
	control: 2,
	ctrl: 2,
	meta: 4,
	cmd: 4,
	command: 4,
	shift: 8,
};
/** Editing commands for shortcuts that macOS Chrome does not run from synthetic key events. */
const COMMANDS: Record<string, string> = { a: "selectAll", c: "copy", v: "paste", x: "cut", z: "undo" };

/** Parse `Control+A`, `Enter`, `Shift+Tab` into a key definition and modifier bits. */
export function parseKeyCombo(combo: string): { definition: KeyDefinition; modifiers: number; commands: string[] } {
	const parts = combo
		.split("+")
		.map((part) => part.trim())
		.filter(Boolean);
	const keyName = parts.pop();
	if (!keyName) throw new BrowserActionError(`Invalid key "${combo}"`);
	let modifiers = 0;
	for (const part of parts) {
		const bit = MODIFIERS[part.toLowerCase()];
		if (!bit)
			throw new BrowserActionError(`Unknown modifier "${part}" in "${combo}". Use Control, Shift, Alt, or Meta.`);
		modifiers |= bit;
	}
	const lower = keyName.toLowerCase();
	let definition = KEYS[KEY_ALIASES[lower] ?? lower];
	if (!definition) {
		if (keyName.length !== 1) {
			throw new BrowserActionError(
				`Unknown key "${keyName}". Use a single character or one of: ${Object.values(KEYS)
					.map((k) => k.code)
					.join(", ")}.`,
			);
		}
		const upper = keyName.toUpperCase();
		const isLetter = /[A-Z]/.test(upper);
		definition = {
			key: modifiers & 8 ? upper : keyName,
			code: isLetter ? `Key${upper}` : /\d/.test(keyName) ? `Digit${keyName}` : "",
			keyCode: upper.charCodeAt(0),
			text: modifiers & ~8 ? undefined : modifiers & 8 ? upper : keyName,
		};
	}
	const commandKey = modifiers & (2 | 4) && !(modifiers & ~(2 | 4)) ? COMMANDS[lower] : undefined;
	return { definition, modifiers, commands: commandKey ? [commandKey] : [] };
}

export async function pressKeys(cdp: CdpClient, tab: Tab, combo: string): Promise<void> {
	const { definition, modifiers, commands } = parseKeyCombo(combo);
	const base = {
		key: definition.key,
		code: definition.code,
		windowsVirtualKeyCode: definition.keyCode,
		nativeVirtualKeyCode: definition.keyCode,
		modifiers,
	};
	await cdp.send(
		"Input.dispatchKeyEvent",
		{
			...base,
			type: definition.text ? "keyDown" : "rawKeyDown",
			...(definition.text ? { text: definition.text, unmodifiedText: definition.text } : {}),
			...(commands.length > 0 ? { commands } : {}),
		},
		tab.sessionId,
	);
	await cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" }, tab.sessionId);
}

export async function typeInto(
	cdp: CdpClient,
	tab: Tab,
	element: ResolvedElement,
	text: string,
	clear: boolean,
): Promise<string> {
	await cdp
		.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: element.backendNodeId }, tab.sessionId)
		.catch(() => {});
	try {
		await cdp.send("DOM.focus", { backendNodeId: element.backendNodeId }, tab.sessionId);
	} catch {
		throw new BrowserActionError(
			`NOT EDITABLE [${element.backendNodeId}]: the element cannot take focus; nothing was typed. Pick a text field from browser_state.`,
		);
	}
	const prepared = await callOn<string>(
		cdp,
		tab.sessionId,
		element.objectId,
		`function(clear) {
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
  const editable = this.isContentEditable || this.tagName === 'INPUT' || this.tagName === 'TEXTAREA';
  if (active !== this && !this.contains(active)) return editable ? 'nofocus' : 'noedit';
  if (!clear) {
    if (this.setSelectionRange && typeof this.value === 'string') { try { this.setSelectionRange(this.value.length, this.value.length); } catch (e) {} }
    return 'ok';
  }
  if (typeof this.select === 'function') this.select();
  else { const range = document.createRange(); range.selectNodeContents(this); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); }
  return 'ok';
}`,
		[clear],
	);
	if (prepared !== "ok") {
		throw new BrowserActionError(
			`NOT EDITABLE [${element.backendNodeId}]: ${prepared === "noedit" ? "the element is not a text field" : "focus went elsewhere"}; nothing was typed. Pick a text field from browser_state.`,
		);
	}
	if (text) await cdp.send("Input.insertText", { text }, tab.sessionId);
	else if (clear) await pressKeys(cdp, tab, "Delete");
	return callOn<string>(
		cdp,
		tab.sessionId,
		element.objectId,
		"function() { return typeof this.value === 'string' ? (this.type === 'password' ? '***' : this.value) : (this.innerText || ''); }",
	).catch(() => "");
}

export async function selectOption(
	cdp: CdpClient,
	tab: Tab,
	element: ResolvedElement,
	option: string,
): Promise<string> {
	const result = await callOn<{ value?: string; error?: string; options?: string[] }>(
		cdp,
		tab.sessionId,
		element.objectId,
		`function(wanted) {
  if (this.tagName !== 'SELECT') return { error: 'not-select' };
  const options = Array.from(this.options);
  const norm = (s) => s.replace(/\\s+/g, ' ').trim().toLowerCase();
  const w = norm(wanted);
  let match = options.filter((o) => norm(o.text) === w || o.value === wanted);
  if (match.length === 0) match = options.filter((o) => norm(o.text).includes(w));
  if (match.length !== 1) return { error: match.length ? 'ambiguous' : 'not-found', options: options.map((o) => o.text.trim()) };
  const o = match[0];
  if (o.disabled) return { error: 'disabled', options: options.map((x) => x.text.trim()) };
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(this, o.value);
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return { value: o.text.trim() };
}`,
		[option],
	);
	if (result.error === "not-select") {
		throw new BrowserActionError(
			`NOT A SELECT [${element.backendNodeId}]: browser_select works on <select> elements only; nothing was selected. For a custom dropdown, browser_click it and then click the option.`,
		);
	}
	if (result.error) {
		const reason =
			result.error === "ambiguous"
				? "matches several options"
				: result.error === "disabled"
					? "is disabled"
					: "is not an option";
		throw new BrowserActionError(
			`OPTION ${JSON.stringify(option)} ${reason}; nothing was selected. Options: ${(result.options ?? []).slice(0, 30).join(" | ")}`,
		);
	}
	return result.value ?? option;
}

/** Scroll the page (or the element / its scroll container) by `pages` viewports. */
export async function scroll(
	cdp: CdpClient,
	tab: Tab,
	pages: number,
	element: ResolvedElement | undefined,
): Promise<{ moved: number; atEnd: boolean; target: string }> {
	const fn = `function(pages) {
  const scrollable = (el) => { if (!el || el === document.body) return false; const s = getComputedStyle(el); return /(auto|scroll|overlay)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1; };
  let target = null;
  if (this && this.nodeType === 1) { target = this; while (target && !scrollable(target)) target = target.parentElement; }
  const page = document.scrollingElement || document.documentElement;
  const run = (el) => {
    const isPage = el === page;
    const height = isPage ? window.innerHeight : el.clientHeight;
    const before = isPage ? window.scrollY : el.scrollTop;
    if (isPage) window.scrollBy(0, pages * height * 0.9); else el.scrollBy(0, pages * height * 0.9);
    const after = isPage ? window.scrollY : el.scrollTop;
    const max = (isPage ? page.scrollHeight - window.innerHeight : el.scrollHeight - el.clientHeight);
    return { moved: Math.round(after - before), atEnd: pages > 0 ? after >= max - 2 : after <= 0, target: isPage ? 'page' : '<' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '>' };
  };
  if (target) return run(target);
  const result = run(page);
  if (result.moved !== 0) return result;
  // Pages that scroll an inner container instead of the document.
  let best = null, area = 0;
  for (const el of document.querySelectorAll('*')) {
    if (!scrollable(el)) continue;
    const r = el.getBoundingClientRect();
    const a = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    if (a > area) { area = a; best = el; }
  }
  return best ? run(best) : result;
}`;
	if (element) {
		return callOn(cdp, tab.sessionId, element.objectId, fn, [pages]);
	}
	return evaluate(cdp, tab.sessionId, `(${fn}).call(null, ${JSON.stringify(pages)})`);
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

/** Matches of `query` in the visible text of the page (and same-origin iframes), with context. */
export async function findText(
	cdp: CdpClient,
	tab: Tab,
	query: string,
	maxResults: number,
): Promise<{ total: number; snippets: string[] }> {
	return evaluate(
		cdp,
		tab.sessionId,
		`((query, max) => {
  const texts = [document.body ? document.body.innerText : ''];
  for (let i = 0; i < window.frames.length; i++) { try { const b = window.frames[i].document.body; if (b) texts.push(b.innerText); } catch (e) {} }
  const text = texts.join('\\n').replace(/[ \\t]+/g, ' ');
  const lower = text.toLowerCase(), q = query.toLowerCase();
  const snippets = []; let total = 0, at = 0;
  while (q && (at = lower.indexOf(q, at)) !== -1) {
    total++;
    if (snippets.length < max) {
      const start = Math.max(0, at - 80), end = Math.min(text.length, at + q.length + 80);
      snippets.push((start > 0 ? '…' : '') + text.slice(start, end).replace(/\\s+/g, ' ').trim() + (end < text.length ? '…' : ''));
    }
    at += q.length;
  }
  return { total, snippets };
})(${JSON.stringify(query)}, ${maxResults})`,
	);
}

/** Wait until text appears (or disappears) or the URL contains a string. */
export async function waitFor(
	cdp: CdpClient,
	tab: Tab,
	condition: { text?: string; url?: string; gone?: boolean },
	timeoutMs: number,
	signal: AbortSignal | undefined,
): Promise<number> {
	const started = Date.now();
	const expression = `(() => {
  const want = ${JSON.stringify(condition)};
  if (want.url !== undefined && !location.href.includes(want.url)) return false;
  if (want.text !== undefined) {
    const texts = [document.body ? document.body.innerText : ''];
    for (let i = 0; i < window.frames.length; i++) { try { texts.push(window.frames[i].document.body.innerText); } catch (e) {} }
    const found = texts.join('\\n').toLowerCase().includes(want.text.toLowerCase());
    return want.gone ? !found : found;
  }
  return true;
})()`;
	while (Date.now() - started < timeoutMs) {
		if (signal?.aborted) throw new BrowserActionError("Aborted");
		const ok = await evaluate<boolean>(cdp, tab.sessionId, expression, 5000).catch(() => false);
		if (ok) return Date.now() - started;
		await sleep(250);
	}
	const what = [
		condition.text !== undefined
			? `text ${JSON.stringify(condition.text)} ${condition.gone ? "still present" : "not found"}`
			: "",
		condition.url !== undefined ? `url does not contain ${JSON.stringify(condition.url)}` : "",
	]
		.filter(Boolean)
		.join(", ");
	throw new BrowserActionError(
		`TIMEOUT after ${Math.round(timeoutMs / 1000)}s: ${what}. Take a browser_state to see the page.`,
	);
}

export async function screenshot(
	cdp: CdpClient,
	tab: Tab,
	maxDim: number,
): Promise<{ data: string; width: number; height: number }> {
	const { cssVisualViewport: v } = await cdp.send<{
		cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
	}>("Page.getLayoutMetrics", {}, tab.sessionId);
	const scale = Math.min(1, maxDim / Math.max(v.clientWidth, v.clientHeight));
	const { data } = await cdp.send<{ data: string }>(
		"Page.captureScreenshot",
		{
			format: "png",
			clip: { x: v.pageX, y: v.pageY, width: v.clientWidth, height: v.clientHeight, scale },
		},
		tab.sessionId,
		20_000,
	);
	return { data, width: Math.round(v.clientWidth * scale), height: Math.round(v.clientHeight * scale) };
}
