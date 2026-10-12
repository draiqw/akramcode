/**
 * One browser connection per process: the page targets (tabs) this session opened, the tab the
 * tools act on, JS dialogs, and page loading. Chrome is started lazily on first use and the
 * connection is re-opened when Chrome was restarted.
 */

import { type CdpClient, CdpConnection } from "./cdp.ts";
import type { ElementFingerprint, TabSummary } from "./state.ts";

export interface TargetInfo {
	targetId: string;
	type: string;
	url: string;
	title: string;
	openerId?: string;
}

/** A tab the tools can act on. */
export interface Tab {
	targetId: string;
	sessionId: string;
	url: string;
	title: string;
	/** Dialogs dismissed since the last report, as `alert: text (dismissed)`. */
	dialogs: string[];
	/** Whether the main frame is loading. */
	loading: boolean;
	/** Increases with every main-frame load start, so actions can tell that a navigation began. */
	loadStarts: number;
	/** Fingerprints of elements the model was shown, by index (backendNodeId). */
	elements: Map<number, ElementFingerprint>;
}

export interface BrowserConnector {
	/** Browser WebSocket URL; launches Chrome when needed. */
	resolveUrl(): Promise<string>;
	connect(url: string): Promise<CdpClient & { onClose(handler: () => void): () => void; close(): void }>;
	/** Whether the browser is the user's own (`browser.cdpUrl`), whose browser-wide settings are left alone. */
	isUserBrowser?(): boolean;
}

const MAX_FINGERPRINTS = 5000;

/** Attach to new targets paused, with flat sessions, so they can be prepared before they run. */
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };
/** Document requests: navigations, redirects, form posts, and frames. */
const DOCUMENT_REQUESTS = { patterns: [{ urlPattern: "*", resourceType: "Document" }] };

/**
 * Why a page may not load `url` (`is outside ...`), or undefined when it may. Only http(s) pages
 * and `about:blank` are ever allowed: `file:`, `chrome:`, and `view-source:` would let a page or the
 * model read local files and browser internals.
 */
export function blockedReason(url: string, allowedDomains: readonly string[] | undefined): string | undefined {
	if (url === "about:blank") return undefined;
	let host: string;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "is not an http or https page";
		host = parsed.hostname.toLowerCase();
	} catch {
		return "is not a valid URL";
	}
	if (!allowedDomains || allowedDomains.length === 0) return undefined;
	const allowed = allowedDomains.some((entry) => {
		const domain = entry.trim().toLowerCase().replace(/^\*\./, "");
		return domain !== "" && (host === domain || host.endsWith(`.${domain}`));
	});
	return allowed ? undefined : `is outside browser.allowedDomains (${allowedDomains.join(", ")})`;
}

export class Browser {
	private readonly connector: BrowserConnector;
	private connection: (CdpClient & { close(): void }) | undefined;
	private connecting: Promise<CdpClient> | undefined;
	private readonly targets = new Map<string, TargetInfo>();
	/** Tabs opened by this session, or by its tabs (popups). */
	private readonly owned = new Set<string>();
	private readonly tabs = new Map<string, Tab>();
	/** Sessions of pages Chrome attached on creation, by target id; `attach()` reuses them. */
	private readonly autoSessions = new Map<string, Promise<string | undefined>>();
	/** Target ids of those sessions, by session id. */
	private readonly autoSessionTargets = new Map<string, string>();
	private current: string | undefined;
	/** Set when the connection dropped, reported once with the next result. */
	private lostNotice: string | undefined;

	/** Why a page may not load `url`; checked before every document request, redirects included. */
	private readonly blocked: (url: string) => string | undefined;

	constructor(connector: BrowserConnector, blocked: (url: string) => string | undefined = () => undefined) {
		this.connector = connector;
		this.blocked = blocked;
	}

	/** The connection, opening it (and launching Chrome) when needed. */
	async cdp(): Promise<CdpClient> {
		if (this.connection && !this.connection.closed) return this.connection;
		this.connecting ??= this.open().finally(() => {
			this.connecting = undefined;
		});
		return this.connecting;
	}

	private async open(): Promise<CdpClient> {
		const url = await this.connector.resolveUrl();
		const connection = await this.connector.connect(url);
		try {
			await this.setUp(connection);
		} catch (error) {
			connection.close();
			throw error;
		}
		this.connection = connection;
		return connection;
	}

	private async setUp(
		connection: CdpClient & { onClose(handler: () => void): () => void; close(): void },
	): Promise<void> {
		// Request checks of the old connection ended with it, so tabs opened before cannot be trusted.
		const previous = [...this.owned];
		this.targets.clear();
		this.autoSessions.clear();
		this.autoSessionTargets.clear();
		this.owned.clear();
		this.tabs.clear();
		this.current = undefined;
		connection.onClose(() => {
			if (this.connection === connection) this.connection = undefined;
		});
		connection.on("Target.targetCreated", (params) =>
			this.onTarget((params as { targetInfo: TargetInfo }).targetInfo),
		);
		connection.on("Target.targetInfoChanged", (params) =>
			this.onTarget((params as { targetInfo: TargetInfo }).targetInfo),
		);
		connection.on("Target.targetDestroyed", (params) => this.onTargetGone((params as { targetId: string }).targetId));
		// By session: a target can have several (a released auto-attach session and the tab's own).
		connection.on("Target.detachedFromTarget", (params) => {
			const { sessionId } = params as { sessionId: string };
			for (const [id, tab] of this.tabs) {
				if (tab.sessionId === sessionId) {
					this.tabs.delete(id);
					this.autoSessions.delete(id);
				}
			}
			const autoTarget = this.autoSessionTargets.get(sessionId);
			if (autoTarget !== undefined) {
				this.autoSessionTargets.delete(sessionId);
				this.autoSessions.delete(autoTarget);
			}
		});
		connection.on("Page.javascriptDialogOpening", (params, sessionId) => {
			const dialog = params as { type: string; message: string };
			const tab = [...this.tabs.values()].find((candidate) => candidate.sessionId === sessionId);
			// beforeunload must be accepted or the navigation the model asked for never happens.
			const accept = dialog.type === "beforeunload";
			tab?.dialogs.push(
				`${dialog.type}: ${JSON.stringify(dialog.message.slice(0, 300))} (${accept ? "accepted" : "dismissed"})`,
			);
			connection.send("Page.handleJavaScriptDialog", { accept }, sessionId).catch(() => {});
		});
		// Document requests (navigations, form posts, redirects, frames) pause here before they are sent.
		connection.on("Fetch.requestPaused", (params, sessionId) => {
			const { requestId, request } = params as { requestId: string; request: { url: string } };
			let reason: string | undefined = "could not be checked";
			try {
				reason = this.blocked(request.url);
			} catch {}
			if (!reason) {
				connection.send("Fetch.continueRequest", { requestId }, sessionId).catch(() => {});
				return;
			}
			this.tabBySession(sessionId)?.dialogs.push(`blocked: ${request.url} ${reason}`);
			connection.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sessionId).catch(() => {});
		});
		connection.on("Page.frameStartedLoading", (params, sessionId) => {
			const tab = this.tabBySession(sessionId);
			if (tab && (params as { frameId: string }).frameId === tab.targetId) {
				tab.loading = true;
				tab.loadStarts++;
			}
		});
		connection.on("Page.frameStoppedLoading", (params, sessionId) => {
			const tab = this.tabBySession(sessionId);
			if (tab && (params as { frameId: string }).frameId === tab.targetId) tab.loading = false;
		});
		// New pages, popups, and cross-origin frames start paused, so request checks are in place before
		// their first request.
		// Only this session's pages are checked: the user's own tabs in the same browser are left alone.
		connection.on("Target.attachedToTarget", (params, parentSessionId) => {
			const { sessionId, targetInfo, waitingForDebugger } = params as {
				sessionId: string;
				targetInfo: TargetInfo;
				waitingForDebugger: boolean;
			};
			// Frames and pages attached from a session prepared here belong to an owned page.
			const owned =
				parentSessionId !== undefined ||
				this.owned.has(targetInfo.targetId) ||
				(targetInfo.openerId !== undefined && this.owned.has(targetInfo.openerId));
			if (owned && targetInfo.type === "page") this.owned.add(targetInfo.targetId);
			if (owned) {
				void this.prepareSession(connection, sessionId, targetInfo, waitingForDebugger);
				return;
			}
			// Not ours, such as the user's tabs and workers, or a tab of ours whose id is not known yet
			// (attach() checks it before use): let it run and stay out of it.
			void (async () => {
				if (waitingForDebugger) {
					await connection.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
				}
				await connection.send("Target.detachFromTarget", { sessionId }).catch(() => {});
			})();
		});
		await connection.send("Target.setAutoAttach", AUTO_ATTACH);
		await connection.send("Target.setDiscoverTargets", { discover: true });
		// Without a browser context this applies to the whole browser, so not to the user's own.
		if (!this.connector.isUserBrowser?.()) {
			await connection.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
		}
		const { targetInfos } = await connection.send<{ targetInfos: TargetInfo[] }>("Target.getTargets");
		for (const info of targetInfos) {
			if (previous.includes(info.targetId)) {
				await connection.send("Target.closeTarget", { targetId: info.targetId }).catch(() => {});
			} else {
				this.onTarget(info);
			}
		}
		if (previous.length > 0) this.lostNotice = "The browser connection was lost; tabs opened earlier were closed.";
	}

	private async prepareSession(
		connection: CdpClient,
		sessionId: string,
		target: { targetId: string; type: string },
		waiting: boolean,
	): Promise<void> {
		if (target.type === "page" || target.type === "iframe") {
			const secured = (async () => {
				try {
					await connection.send("Fetch.enable", DOCUMENT_REQUESTS, sessionId);
					await connection.send("Target.setAutoAttach", AUTO_ATTACH, sessionId);
					return sessionId;
				} catch {
					return undefined;
				}
			})();
			if (target.type === "page") {
				this.autoSessions.set(target.targetId, secured);
				this.autoSessionTargets.set(sessionId, target.targetId);
			}
			if (!(await secured)) {
				// Fail closed: a target whose requests cannot be checked never runs.
				if (target.type === "page") {
					await connection.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
				}
				return;
			}
		}
		if (waiting) await connection.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
	}

	private tabBySession(sessionId: string | undefined): Tab | undefined {
		if (!sessionId) return undefined;
		for (const tab of this.tabs.values()) if (tab.sessionId === sessionId) return tab;
		return undefined;
	}

	private onTarget(info: TargetInfo): void {
		if (info.type !== "page") return;
		this.targets.set(info.targetId, info);
		if (info.openerId && this.owned.has(info.openerId)) this.owned.add(info.targetId);
		const tab = this.tabs.get(info.targetId);
		if (tab) {
			tab.url = info.url;
			tab.title = info.title;
		}
	}

	private onTargetGone(targetId: string): void {
		this.targets.delete(targetId);
		this.autoSessions.delete(targetId);
		this.owned.delete(targetId);
		this.tabs.delete(targetId);
		if (this.current === targetId) this.current = undefined;
	}

	/** Report-once notice about a lost browser. */
	takeNotice(): string | undefined {
		const notice = this.lostNotice;
		this.lostNotice = undefined;
		return notice;
	}

	/** Short, unique tab ids for the model. */
	tabId(targetId: string): string {
		const ids = [...this.owned];
		for (let length = 4; length < targetId.length; length += 2) {
			const id = targetId.slice(-length).toLowerCase();
			if (ids.every((other) => other === targetId || !other.toLowerCase().endsWith(id))) return id;
		}
		return targetId.toLowerCase();
	}

	findTab(id: string): string | undefined {
		const wanted = id.toLowerCase();
		return [...this.owned].find((targetId) => targetId.toLowerCase().endsWith(wanted));
	}

	listTabs(): TabSummary[] {
		return [...this.owned].flatMap((targetId) => {
			const info = this.targets.get(targetId);
			return info
				? [{ id: this.tabId(targetId), title: info.title, url: info.url, current: targetId === this.current }]
				: [];
		});
	}

	ownedTargetIds(): string[] {
		return [...this.owned];
	}

	/** Open a new background tab and make it current. */
	async newTab(): Promise<Tab> {
		const cdp = await this.cdp();
		const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", {
			url: "about:blank",
			background: true,
		});
		this.owned.add(targetId);
		return this.attach(targetId);
	}

	/** Make an owned tab current, attaching to it when needed. */
	async attach(targetId: string): Promise<Tab> {
		const existing = this.tabs.get(targetId);
		if (existing) {
			this.current = targetId;
			return existing;
		}
		const cdp = await this.cdp();
		const pending = this.autoSessions.get(targetId);
		const auto = pending ? await pending : undefined;
		if (pending && !auto) throw new Error("The tab was closed: its requests could not be checked.");
		const sessionId =
			auto ??
			(await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true })).sessionId;
		const info = this.targets.get(targetId);
		const tab: Tab = {
			targetId,
			sessionId,
			url: info?.url ?? "",
			title: info?.title ?? "",
			dialogs: [],
			loading: false,
			loadStarts: 0,
			elements: new Map(),
		};
		this.tabs.set(targetId, tab);
		try {
			if (!auto) {
				// A page that existed before this connection: check its requests and its new frames from now on.
				await cdp.send("Fetch.enable", DOCUMENT_REQUESTS, sessionId);
				await cdp.send("Target.setAutoAttach", AUTO_ATTACH, sessionId).catch(() => {});
			}
			await cdp.send("Page.enable", {}, sessionId);
		} catch (error) {
			// A cached tab is used as is, so one whose requests are not checked must not stay.
			this.tabs.delete(targetId);
			throw error;
		}
		// The page believes it has focus even though the window is in the background.
		await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId).catch(() => {});
		this.current = targetId;
		return tab;
	}

	/** The current tab, or undefined when there is none. */
	async currentTab(): Promise<Tab | undefined> {
		await this.cdp();
		if (this.current && this.targets.has(this.current)) return this.attach(this.current);
		this.current = undefined;
		return undefined;
	}

	async closeTab(targetId: string): Promise<void> {
		const cdp = await this.cdp();
		await cdp.send("Target.closeTarget", { targetId });
		this.onTargetGone(targetId);
	}

	/** Remember the fingerprints of a new state with the document each was seen in, bounded. */
	remember(tab: Tab, elements: Map<number, ElementFingerprint>, loaderIds: Map<string, string>): void {
		for (const [id, fingerprint] of elements) {
			tab.elements.delete(id);
			tab.elements.set(id, { ...fingerprint, loaderId: loaderIds.get(fingerprint.frameId) });
		}
		while (tab.elements.size > MAX_FINGERPRINTS) {
			const oldest = tab.elements.keys().next().value;
			if (oldest === undefined) break;
			tab.elements.delete(oldest);
		}
	}

	/** Tabs opened since `before`, by this session's tabs. */
	openedSince(before: ReadonlySet<string>): string[] {
		return [...this.owned].filter((targetId) => !before.has(targetId));
	}

	/** Close the tabs this session opened. Chrome keeps running for later sessions. */
	async closeOwnedTabs(): Promise<void> {
		if (!this.connection || this.connection.closed) return;
		for (const targetId of [...this.owned]) {
			await this.connection.send("Target.closeTarget", { targetId }).catch(() => {});
		}
	}

	disconnect(): void {
		this.connection?.close();
		this.connection = undefined;
	}
}

export function defaultConnector(resolveUrl: () => Promise<string>, isUserBrowser?: () => boolean): BrowserConnector {
	return { resolveUrl, connect: (url) => CdpConnection.connect(url), ...(isUserBrowser ? { isUserBrowser } : {}) };
}
