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
}

const MAX_FINGERPRINTS = 5000;

/** Attach to new targets paused, with flat sessions, so they can be prepared before they run. */
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };
/** Document requests: navigations, redirects, form posts, and frames. */
const DOCUMENT_REQUESTS = { patterns: [{ urlPattern: "*", resourceType: "Document" }] };

export function isAllowedUrl(url: string, allowedDomains: readonly string[] | undefined): boolean {
	if (!allowedDomains || allowedDomains.length === 0) return true;
	if (url === "about:blank") return true;
	let host: string;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
		host = parsed.hostname.toLowerCase();
	} catch {
		return false;
	}
	return allowedDomains.some((entry) => {
		const domain = entry.trim().toLowerCase().replace(/^\*\./, "");
		return domain !== "" && (host === domain || host.endsWith(`.${domain}`));
	});
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
	private current: string | undefined;
	/** Set when the connection dropped, reported once with the next result. */
	private lostNotice: string | undefined;

	/** Whether a page may load `url`; checked before every document request, redirects included. */
	private readonly isAllowed: (url: string) => boolean;

	constructor(connector: BrowserConnector, isAllowed: (url: string) => boolean = () => true) {
		this.connector = connector;
		this.isAllowed = isAllowed;
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
		if (this.owned.size > 0) this.lostNotice = "The browser was restarted; earlier tabs are gone.";
		this.targets.clear();
		this.autoSessions.clear();
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
		connection.on("Target.detachedFromTarget", (params) => {
			const { sessionId, targetId } = params as { sessionId?: string; targetId?: string };
			for (const [id, tab] of this.tabs) {
				if (id === targetId || tab.sessionId === sessionId) {
					this.tabs.delete(id);
					this.autoSessions.delete(id);
				}
			}
			if (targetId) this.autoSessions.delete(targetId);
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
			let allowed = false;
			try {
				allowed = this.isAllowed(request.url);
			} catch {}
			if (allowed) {
				connection.send("Fetch.continueRequest", { requestId }, sessionId).catch(() => {});
				return;
			}
			this.tabBySession(sessionId)?.dialogs.push(`blocked: ${request.url} is outside browser.allowedDomains`);
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
		connection.on("Target.attachedToTarget", (params) => {
			const { sessionId, targetInfo, waitingForDebugger } = params as {
				sessionId: string;
				targetInfo: { targetId: string; type: string };
				waitingForDebugger: boolean;
			};
			void this.prepareSession(connection, sessionId, targetInfo, waitingForDebugger);
		});
		await connection.send("Target.setAutoAttach", AUTO_ATTACH);
		await connection.send("Target.setDiscoverTargets", { discover: true });
		const { targetInfos } = await connection.send<{ targetInfos: TargetInfo[] }>("Target.getTargets");
		for (const info of targetInfos) this.onTarget(info);
		this.connection = connection;
		return connection;
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
			if (target.type === "page") this.autoSessions.set(target.targetId, secured);
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
		if (!auto) {
			// A page that existed before this connection: check its requests and its new frames from now on.
			await cdp.send("Fetch.enable", DOCUMENT_REQUESTS, sessionId);
			await cdp.send("Target.setAutoAttach", AUTO_ATTACH, sessionId).catch(() => {});
		}
		await cdp.send("Page.enable", {}, sessionId);
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

export function defaultConnector(resolveUrl: () => Promise<string>): BrowserConnector {
	return { resolveUrl, connect: (url) => CdpConnection.connect(url) };
}
