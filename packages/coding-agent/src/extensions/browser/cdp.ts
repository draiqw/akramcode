/**
 * Minimal Chrome DevTools Protocol client over the global WebSocket. One connection to the browser
 * target; page targets are reached through flattened sessions (`Target.attachToTarget` with
 * `flatten: true`), so every command and event carries an optional `sessionId`.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

/** What the browser code needs from a CDP connection. Tests provide fakes. */
export interface CdpClient {
	send<T = unknown>(method: string, params?: object, sessionId?: string, timeoutMs?: number): Promise<T>;
	/** Subscribe to an event; the handler gets the params and the session it came from. */
	on(method: string, handler: (params: unknown, sessionId: string | undefined) => void): () => void;
	readonly closed: boolean;
}

export class CdpError extends Error {
	readonly method: string;
	readonly code: number | undefined;
	constructor(method: string, message: string, code?: number) {
		super(`${method}: ${message}`);
		this.method = method;
		this.code = code;
	}
}

interface Pending {
	method: string;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface CdpMessage {
	id?: number;
	method?: string;
	params?: unknown;
	sessionId?: string;
	result?: unknown;
	error?: { code?: number; message?: string };
}

export class CdpConnection implements CdpClient {
	private readonly socket: WebSocket;
	private nextId = 1;
	private readonly pending = new Map<number, Pending>();
	private readonly handlers = new Map<string, Set<(params: unknown, sessionId: string | undefined) => void>>();
	private readonly closeHandlers = new Set<() => void>();
	private isClosed = false;

	private constructor(socket: WebSocket) {
		this.socket = socket;
		socket.addEventListener("message", (event) => this.onMessage(event.data));
		socket.addEventListener("close", () => this.handleClose());
		socket.addEventListener("error", () => this.handleClose());
	}

	/** Open a connection to a CDP WebSocket URL (`ws://host:port/devtools/browser/<id>`). */
	static connect(url: string, timeoutMs = 10_000): Promise<CdpConnection> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(url);
			const timer = setTimeout(() => {
				socket.close();
				reject(new Error(`CDP connection to ${url} timed out`));
			}, timeoutMs);
			socket.addEventListener("open", () => {
				clearTimeout(timer);
				resolve(new CdpConnection(socket));
			});
			socket.addEventListener("error", () => {
				clearTimeout(timer);
				reject(new Error(`Could not connect to CDP at ${url}`));
			});
		});
	}

	get closed(): boolean {
		return this.isClosed;
	}

	send<T = unknown>(
		method: string,
		params: object = {},
		sessionId?: string,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	): Promise<T> {
		if (this.isClosed) return Promise.reject(new CdpError(method, "browser connection closed"));
		const id = this.nextId++;
		const message: CdpMessage & { params: object } = { id, method, params };
		if (sessionId) message.sessionId = sessionId;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new CdpError(method, `timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(id, { method, resolve: (value) => resolve(value as T), reject, timer });
			this.socket.send(JSON.stringify(message));
		});
	}

	on(method: string, handler: (params: unknown, sessionId: string | undefined) => void): () => void {
		let set = this.handlers.get(method);
		if (!set) {
			set = new Set();
			this.handlers.set(method, set);
		}
		set.add(handler);
		return () => set.delete(handler);
	}

	onClose(handler: () => void): () => void {
		this.closeHandlers.add(handler);
		return () => this.closeHandlers.delete(handler);
	}

	close(): void {
		if (!this.isClosed) this.socket.close();
		this.handleClose();
	}

	private onMessage(data: unknown): void {
		if (typeof data !== "string") return;
		let message: CdpMessage;
		try {
			message = JSON.parse(data) as CdpMessage;
		} catch {
			return;
		}
		if (message.id !== undefined) {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			clearTimeout(pending.timer);
			if (message.error) {
				pending.reject(new CdpError(pending.method, message.error.message ?? "failed", message.error.code));
			} else {
				pending.resolve(message.result ?? {});
			}
			return;
		}
		if (message.method) {
			for (const handler of this.handlers.get(message.method) ?? []) {
				try {
					handler(message.params, message.sessionId);
				} catch {
					// A failing handler must not break the connection.
				}
			}
		}
	}

	private handleClose(): void {
		if (this.isClosed) return;
		this.isClosed = true;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new CdpError(pending.method, "browser connection closed"));
		}
		this.pending.clear();
		for (const handler of this.closeHandlers) handler();
	}
}
