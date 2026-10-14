/**
 * Marks the tabs the agent drives, so they stand out next to the user's own tabs: an orange `a` icon
 * in the tab strip instead of the site's icon, and a border with an `akramcode` badge on the page.
 * The page marker lives in a closed shadow root under `<html>` and ignores the mouse; neither is
 * part of the page state the model sees.
 */

import type { CdpClient } from "./cdp.ts";

/** Tag of the marker element; `state.ts` skips it. */
export const INDICATOR_TAG = "akramcode-indicator";

const ICON = `data:image/svg+xml,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#d97757"/>' +
		'<text x="16" y="23" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#fff">a</text></svg>',
)}`;

const SCRIPT = `(() => {
	// Once per document: the script can run twice (registered and evaluated), and two copies would
	// keep moving their icons after each other forever.
	const once = Symbol.for("akramcode-indicator");
	if (window.top !== window || window[once]) return;
	Object.defineProperty(window, once, { value: true });
	// DOM methods, not innerHTML: pages with Trusted Types reject HTML strings.
	const host = document.createElement(${JSON.stringify(INDICATOR_TAG)});
	host.style.cssText = "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;";
	const root = host.attachShadow({ mode: "closed" });
	const box = (css, text) => {
		const element = document.createElement("div");
		element.style.cssText = css + "; pointer-events: none;";
		if (text) element.textContent = text;
		root.appendChild(element);
	};
	box("position: fixed; inset: 0; border: 3px solid #d97757; box-sizing: border-box");
	box("position: fixed; top: 6px; right: 6px; padding: 2px 8px; border-radius: 4px; background: #d97757; color: #fff; font: 600 12px/18px system-ui, sans-serif; opacity: 0.9", "akramcode");
	// Only the children of the document and of <html> are watched: pages that rebuild <html> or
	// remove its unknown children drop the marker, and it comes back.
	const watcher = new MutationObserver(() => add());
	const add = () => {
		const html = document.documentElement;
		if (!html) return;
		if (host.parentNode !== html) html.appendChild(host);
		watcher.disconnect();
		watcher.observe(document, { childList: true });
		watcher.observe(html, { childList: true });
	};
	add();
	if (!document.documentElement) document.addEventListener("DOMContentLoaded", add, { once: true });

	// The tab icon: the last icon link wins, so it moves to the end when the page adds its own.
	const icon = document.createElement("link");
	icon.rel = "icon";
	icon.href = ${JSON.stringify(ICON)};
	const headWatcher = new MutationObserver(() => setIcon());
	const setIcon = () => {
		const head = document.head;
		if (!head) return;
		if ([...head.querySelectorAll("link[rel~=icon]")].at(-1) !== icon) head.appendChild(icon);
		headWatcher.disconnect();
		headWatcher.observe(head, { childList: true });
	};
	setIcon();
	if (!document.head) document.addEventListener("DOMContentLoaded", setIcon, { once: true });
})();`;

/** Show the marker in a page session: in the current document and every later one. */
export async function addIndicator(cdp: CdpClient, sessionId: string): Promise<void> {
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SCRIPT }, sessionId);
	await cdp.send("Runtime.evaluate", { expression: SCRIPT }, sessionId).catch(() => {});
}
