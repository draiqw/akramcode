/**
 * Process-wide HTTP and WebSocket capture. HTTP is observed through undici's diagnostics
 * channels, which every `fetch` in the process reports to (the global fetch is undici's, see
 * http-dispatcher.ts, and Node's built-in fetch publishes on the same channels). WebSocket frames
 * are observed by wrapping `WebSocket.prototype.send` and listening for messages on each socket
 * that sends. Requests made with `node:http`/`node:https` directly, by child processes, or by
 * runtimes without these channels (the Bun binary) are not seen.
 */

import diagnosticsChannel from "node:diagnostics_channel";
import * as zlib from "node:zlib";
import type { BodyRef, HttpRecord, NetworkInfo, WebSocketRecord } from "./format.ts";
import type { Redactor } from "./redact.ts";
import { type CaptureFile, type MemoryBudget, sha1 } from "./writer.ts";

export interface TraceContext {
	sessionId?: string;
	modelRequestId?: string;
}

export interface NetworkSink {
	readonly redactor: Redactor;
	readonly maxBodyBytes: number;
	/** Shared limit on bytes buffered by all in-flight captures. */
	readonly budget: MemoryBudget;
	context(): TraceContext | undefined;
	fileFor(context: TraceContext | undefined): CaptureFile | undefined;
	newId(prefix: string): string;
	/** sha1 of the payload of an in-flight or recent model request, for body deduplication. */
	payloadSha1(modelRequestId: string): string | undefined;
}

interface SocketInfo {
	connectedAt: number;
	connectMs?: number;
	proxied?: boolean;
}

interface PendingHttp {
	id: string;
	t: number;
	perf: number;
	context: TraceContext | undefined;
	method: string;
	origin: string;
	path: string;
	headers: Record<string, string | string[]>;
	requestChunks: Buffer[];
	requestStored: number;
	bytesOut: number;
	requestTruncated: boolean;
	initialBody?: Buffer;
	/** Budget bytes held by this request; shared with the finalizer that releases them on GC. */
	reservation: { bytes: number };
	note?: string;
	sendPerf?: number;
	headersPerf?: number;
	status?: number;
	statusText?: string;
	responseHeaders?: Record<string, string | string[]>;
	responseChunks: Buffer[];
	responseStored: number;
	bytesIn: number;
	responseTruncated: boolean;
	network: NetworkInfo;
	connectMs?: number;
	reusedConnection?: boolean;
	upgrade?: boolean;
}

interface UndiciRequestLike {
	origin?: unknown;
	path?: unknown;
	method?: unknown;
	headers?: unknown;
	body?: unknown;
	upgrade?: unknown;
}

interface SocketLike {
	remoteAddress?: string;
	remotePort?: number;
	remoteFamily?: string;
	localAddress?: string;
	localPort?: number;
	alpnProtocol?: string | false;
	servername?: string | false;
	getProtocol?: () => string | null;
	getCipher?: () => { name?: string } | undefined;
}

const MAX_TRACKED_WEBSOCKETS = 256;
const TEXT_CONTENT_TYPE = /json|text|xml|javascript|event-stream|x-www-form-urlencoded|graphql|ndjson/i;

function toBuffer(chunk: unknown): Buffer | undefined {
	if (typeof chunk === "string") return Buffer.from(chunk);
	if (Buffer.isBuffer(chunk)) return chunk;
	if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
	return undefined;
}

function addHeader(target: Record<string, string | string[]>, name: string, value: string): void {
	const key = name.toLowerCase();
	const existing = target[key];
	if (existing === undefined) target[key] = value;
	else target[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
}

/** undici request headers are a flat `[name, value, ...]` array or a raw `name: value\r\n` block. */
function parseRequestHeaders(raw: unknown): Record<string, string | string[]> {
	const headers: Record<string, string | string[]> = {};
	if (Array.isArray(raw)) {
		for (let i = 0; i + 1 < raw.length; i += 2) {
			const value = raw[i + 1];
			for (const item of Array.isArray(value) ? value : [value]) addHeader(headers, String(raw[i]), String(item));
		}
	} else if (typeof raw === "string") {
		for (const line of raw.split("\r\n")) {
			const colon = line.indexOf(":");
			if (colon > 0) addHeader(headers, line.slice(0, colon).trim(), line.slice(colon + 1).trim());
		}
	}
	return headers;
}

function parseResponseHeaders(raw: unknown): Record<string, string | string[]> {
	const headers: Record<string, string | string[]> = {};
	if (!Array.isArray(raw)) return headers;
	for (let i = 0; i + 1 < raw.length; i += 2) {
		addHeader(headers, String(raw[i]), String(raw[i + 1]));
	}
	return headers;
}

function headerValue(headers: Record<string, string | string[]> | undefined, name: string): string | undefined {
	const value = headers?.[name];
	return Array.isArray(value) ? value.join(", ") : value;
}

type SyncDecompress = (data: Buffer, options: { maxOutputLength: number }) => Buffer;

/** zstd exists in newer Node versions only. */
const zstdDecompressSync = (zlib as unknown as { zstdDecompressSync?: SyncDecompress }).zstdDecompressSync;

export class DecompressionLimitError extends Error {
	constructor(limit: number) {
		super(`decompressed body exceeds the capture limit of ${limit} bytes`);
		this.name = "DecompressionLimitError";
	}
}

/**
 * Decode a content-encoded body. Output is capped with zlib's `maxOutputLength`, so a small
 * compressed body cannot expand into gigabytes (a decompression bomb).
 */
export function decodeBody(data: Buffer, encoding: string | undefined, maxOutputBytes: number): Buffer {
	const codings = (encoding ?? "")
		.split(",")
		.map((coding) => coding.trim().toLowerCase())
		.filter((coding) => coding && coding !== "identity")
		.reverse();
	const options = { maxOutputLength: Math.max(1, Math.min(maxOutputBytes, 2 ** 31 - 1)) };
	let result = data;
	for (const coding of codings) {
		try {
			if (coding === "gzip" || coding === "x-gzip") result = zlib.gunzipSync(result, options);
			else if (coding === "deflate") result = zlib.inflateSync(result, options);
			else if (coding === "br") result = zlib.brotliDecompressSync(result, options);
			else if (coding === "zstd" && zstdDecompressSync) result = zstdDecompressSync(result, options);
			else throw new Error(`unsupported content-encoding ${coding}`);
		} catch (error) {
			if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError) {
				throw new DecompressionLimitError(maxOutputBytes);
			}
			throw error;
		}
	}
	return result;
}

function socketInfo(socket: SocketLike | undefined): NetworkInfo {
	if (!socket) return {};
	const info: NetworkInfo = {};
	if (socket.remoteAddress) info.remoteAddress = socket.remoteAddress;
	if (socket.remotePort) info.remotePort = socket.remotePort;
	if (socket.remoteFamily) info.remoteFamily = socket.remoteFamily;
	if (socket.localAddress) info.localAddress = socket.localAddress;
	if (socket.localPort) info.localPort = socket.localPort;
	try {
		const protocol = socket.getProtocol?.();
		if (protocol) info.tlsProtocol = protocol;
		const cipher = socket.getCipher?.()?.name;
		if (cipher) info.cipher = cipher;
	} catch {
		// Not a TLS socket.
	}
	if (socket.alpnProtocol) info.alpnProtocol = socket.alpnProtocol;
	if (socket.servername) info.servername = socket.servername;
	info.httpVersion = socket.alpnProtocol === "h2" ? "2" : "1.1";
	return info;
}

function proxyFor(url: string, redactor: Redactor): string | undefined {
	const env = process.env;
	const proxy = url.startsWith("https:")
		? (env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy)
		: (env.HTTP_PROXY ?? env.http_proxy);
	return proxy ? redactor.url(proxy) : undefined;
}

export class NetworkCapture {
	private readonly sink: NetworkSink;
	private readonly pending = new WeakMap<object, PendingHttp>();
	/**
	 * Releases the budget of requests that never reported an end (a dropped request object is
	 * garbage-collected without trailers or error), so the budget cannot leak.
	 */
	private readonly finalizer = new FinalizationRegistry<{ bytes: number }>((reservation) => {
		this.sink.budget.release(reservation.bytes);
		reservation.bytes = 0;
	});
	private readonly sockets = new WeakMap<object, SocketInfo>();
	private readonly connecting = new Map<string, number>();
	private readonly subscriptions: Array<[string, (message: unknown) => void]> = [];
	private readonly webSockets = new Map<object, WebSocketExchange>();
	private readonly upgradeNetwork = new Map<
		string,
		{ network: NetworkInfo & { connectMs?: number }; requestHeaders: Record<string, string | string[]> }
	>();
	private readonly patchedPrototypes = new Set<{ send: (data: unknown) => void }>();
	private readonly originalSends = new Map<{ send: (data: unknown) => void }, (data: unknown) => void>();

	constructor(sink: NetworkSink) {
		this.sink = sink;
	}

	install(): void {
		this.subscribe("undici:request:create", (message) => this.onCreate(message));
		this.subscribe("undici:request:bodyChunkSent", (message) => this.onBodySent(message));
		this.subscribe("undici:client:beforeConnect", (message) => this.onBeforeConnect(message));
		this.subscribe("undici:client:connected", (message) => this.onConnected(message));
		this.subscribe("undici:proxy:connected", (message) => this.onProxyConnected(message));
		this.subscribe("undici:client:sendHeaders", (message) => this.onSendHeaders(message));
		this.subscribe("undici:request:headers", (message) => this.onHeaders(message));
		this.subscribe("undici:request:bodyChunkReceived", (message) => this.onBodyReceived(message));
		this.subscribe("undici:request:trailers", (message) => this.onEnd(message, undefined));
		this.subscribe("undici:request:error", (message) => this.onEnd(message, (message as { error?: unknown }).error));
		this.subscribe("undici:websocket:open", (message) => this.onWebSocketOpen(message));
		const ctor = (globalThis as { WebSocket?: { prototype?: { send: (data: unknown) => void } } }).WebSocket;
		if (ctor?.prototype) this.patchWebSocket(ctor.prototype);
	}

	uninstall(): void {
		for (const [name, handler] of this.subscriptions) diagnosticsChannel.unsubscribe(name, handler);
		this.subscriptions.length = 0;
		for (const [proto, send] of this.originalSends) proto.send = send;
		this.originalSends.clear();
		this.patchedPrototypes.clear();
		this.flushWebSockets();
	}

	private subscribe(name: string, handler: (message: unknown) => void): void {
		// A throwing subscriber would surface as an uncaught exception in the request path.
		const safe = (message: unknown) => {
			try {
				handler(message);
			} catch {
				// Ignore capture failures.
			}
		};
		diagnosticsChannel.subscribe(name, safe);
		this.subscriptions.push([name, safe]);
	}

	private onCreate(message: unknown): void {
		const request = (message as { request?: UndiciRequestLike }).request;
		if (!request) return;
		const origin = String(request.origin ?? "");
		const path = String(request.path ?? "");
		const pending: PendingHttp = {
			id: this.sink.newId("h"),
			t: Date.now(),
			perf: performance.now(),
			context: this.sink.context(),
			method: String(request.method ?? "GET"),
			origin: origin.endsWith("/") ? origin.slice(0, -1) : origin,
			path,
			headers: parseRequestHeaders(request.headers),
			requestChunks: [],
			requestStored: 0,
			bytesOut: 0,
			requestTruncated: false,
			reservation: { bytes: 0 },
			responseChunks: [],
			responseStored: 0,
			bytesIn: 0,
			responseTruncated: false,
			network: {},
			...(request.upgrade ? { upgrade: true } : {}),
		};
		this.pending.set(request, pending);
		this.finalizer.register(request, pending.reservation, pending);
		// A string or buffer body may never be reported chunk by chunk; keep a bounded copy.
		const body = request.body;
		if (typeof body === "string" || body instanceof Uint8Array) {
			const length = typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
			const keep = Math.min(length, this.sink.maxBodyBytes);
			if (this.reserve(pending, keep)) {
				const head = typeof body === "string" ? body.slice(0, keep) : body.subarray(0, keep);
				pending.initialBody = Buffer.from(Buffer.from(head).subarray(0, keep));
				if (keep < length) pending.requestTruncated = true;
			}
		}
	}

	private reserve(pending: PendingHttp, bytes: number): boolean {
		if (bytes <= 0) return true;
		if (!this.sink.budget.tryReserve(bytes)) {
			pending.note = "in-flight capture memory budget exceeded";
			return false;
		}
		pending.reservation.bytes += bytes;
		return true;
	}

	private releaseAll(pending: PendingHttp): void {
		this.sink.budget.release(pending.reservation.bytes);
		pending.reservation.bytes = 0;
		this.finalizer.unregister(pending);
		pending.requestChunks = [];
		pending.responseChunks = [];
		pending.initialBody = undefined;
	}

	/**
	 * Keep a copy of a body chunk, within the per-body limit and the shared budget. The limits are
	 * checked before keeping anything, so one oversized chunk cannot pass them.
	 */
	private keepChunk(pending: PendingHttp, kind: "request" | "response", chunk: Buffer): void {
		const stored = kind === "request" ? pending.requestStored : pending.responseStored;
		const room = this.sink.maxBodyBytes - stored;
		const take = Math.min(room, chunk.length);
		const truncate = () => {
			if (kind === "request") pending.requestTruncated = true;
			else pending.responseTruncated = true;
		};
		if (take <= 0 || !this.reserve(pending, take)) {
			truncate();
			return;
		}
		// Copy: undici may reuse the chunk's memory, and a slice would keep the whole chunk alive.
		const piece = Buffer.from(chunk.subarray(0, take));
		if (kind === "request") {
			pending.requestChunks.push(piece);
			pending.requestStored += take;
		} else {
			pending.responseChunks.push(piece);
			pending.responseStored += take;
		}
		if (take < chunk.length) truncate();
	}

	private onBodySent(message: unknown): void {
		const { request, chunk } = message as { request?: object; chunk?: unknown };
		const pending = request ? this.pending.get(request) : undefined;
		const buffer = toBuffer(chunk);
		if (!pending || !buffer) return;
		if (pending.initialBody) {
			// Chunks are authoritative; drop the copy of the original body.
			this.sink.budget.release(pending.initialBody.length);
			pending.reservation.bytes -= pending.initialBody.length;
			pending.initialBody = undefined;
			pending.requestTruncated = false;
		}
		pending.bytesOut += buffer.length;
		this.keepChunk(pending, "request", buffer);
	}

	private connectKey(params: unknown): string {
		const { protocol, hostname, port } = (params ?? {}) as { protocol?: string; hostname?: string; port?: string };
		return `${protocol}//${hostname}:${port}`;
	}

	private onBeforeConnect(message: unknown): void {
		this.connecting.set(this.connectKey((message as { connectParams?: unknown }).connectParams), performance.now());
	}

	private onConnected(message: unknown): void {
		const { connectParams, socket } = message as { connectParams?: unknown; socket?: object };
		if (!socket) return;
		const key = this.connectKey(connectParams);
		const started = this.connecting.get(key);
		this.connecting.delete(key);
		const now = performance.now();
		const existing = this.sockets.get(socket);
		this.sockets.set(socket, {
			connectedAt: now,
			connectMs: started !== undefined ? now - started : undefined,
			proxied: existing?.proxied,
		});
	}

	private onProxyConnected(message: unknown): void {
		const socket = (message as { socket?: object }).socket;
		if (!socket) return;
		const info = this.sockets.get(socket) ?? { connectedAt: performance.now() };
		info.proxied = true;
		this.sockets.set(socket, info);
	}

	private onSendHeaders(message: unknown): void {
		const { request, headers, socket } = message as {
			request?: object;
			headers?: unknown;
			socket?: SocketLike & object;
		};
		const pending = request ? this.pending.get(request) : undefined;
		if (!pending) return;
		pending.sendPerf = performance.now();
		if (typeof headers === "string") {
			// The raw block is what went on the wire, including headers undici added.
			const parsed = parseRequestHeaders(headers.split("\r\n").slice(1).join("\r\n"));
			if (Object.keys(parsed).length > 0) pending.headers = parsed;
		}
		pending.network = socketInfo(socket);
		const info = socket ? this.sockets.get(socket) : undefined;
		if (info && info.connectedAt >= pending.perf - 1) {
			pending.connectMs = info.connectMs;
			pending.reusedConnection = false;
		} else {
			pending.reusedConnection = true;
		}
		const url = `${pending.origin}${pending.path}`;
		if (info?.proxied) pending.network.proxy = proxyFor(url, this.sink.redactor) ?? "yes";
		if (pending.upgrade && request) {
			// WebSocket handshake: keep the socket details for the WebSocket record, keyed by host and path.
			this.pending.delete(request);
			this.releaseAll(pending);
			this.upgradeNetwork.set(hostPathKey(url), {
				network: {
					...pending.network,
					...(pending.connectMs !== undefined ? { connectMs: round(pending.connectMs) } : {}),
				},
				requestHeaders: this.sink.redactor.headers(pending.headers),
			});
			if (this.upgradeNetwork.size > 64) this.upgradeNetwork.delete(this.upgradeNetwork.keys().next().value ?? "");
		}
	}

	private onHeaders(message: unknown): void {
		const { request, response } = message as {
			request?: object;
			response?: { statusCode?: number; headers?: unknown; statusText?: string };
		};
		const pending = request ? this.pending.get(request) : undefined;
		if (!pending || !response) return;
		pending.headersPerf = performance.now();
		pending.status = response.statusCode;
		pending.statusText = response.statusText;
		pending.responseHeaders = parseResponseHeaders(response.headers);
	}

	private onBodyReceived(message: unknown): void {
		const { request, chunk } = message as { request?: object; chunk?: unknown };
		const pending = request ? this.pending.get(request) : undefined;
		const buffer = toBuffer(chunk);
		if (!pending || !buffer) return;
		pending.bytesIn += buffer.length;
		this.keepChunk(pending, "response", buffer);
	}

	private storeBody(
		file: CaptureFile,
		name: string,
		data: Buffer,
		headers: Record<string, string | string[]> | undefined,
		options: { truncated: boolean; wireBytes: number; payloadSha1?: string; note?: string },
	): BodyRef | undefined {
		if (data.length === 0 && options.wireBytes === 0) return undefined;
		if (data.length === 0 && options.note) {
			return { bytes: 0, truncated: true, wireBytes: options.wireBytes, note: options.note };
		}
		const encoding = headerValue(headers, "content-encoding");
		let decoded = data;
		const extra: Partial<BodyRef> = {};
		if (encoding && !options.truncated) {
			try {
				decoded = decodeBody(data, encoding, this.sink.maxBodyBytes);
				extra.contentEncoding = encoding;
				extra.wireBytes = options.wireBytes;
			} catch (error) {
				return {
					bytes: data.length,
					binary: true,
					contentEncoding: encoding,
					wireBytes: options.wireBytes,
					...(error instanceof DecompressionLimitError ? { truncated: true, note: error.message } : {}),
				};
			}
		}
		const contentType = headerValue(headers, "content-type");
		if (contentType && !TEXT_CONTENT_TYPE.test(contentType)) {
			return { bytes: decoded.length, binary: true, ...extra };
		}
		const text = this.sink.redactor.text(decoded.toString("utf8"));
		if (options.payloadSha1 && sha1(text) === options.payloadSha1) {
			return { bytes: Buffer.byteLength(text), sameAs: "payload" };
		}
		return file.body(name, text, { ...extra, ...(options.truncated ? { truncated: true } : {}) });
	}

	private onEnd(message: unknown, error: unknown): void {
		const request = (message as { request?: object }).request;
		const pending = request ? this.pending.get(request) : undefined;
		if (!request || !pending) return;
		this.pending.delete(request);
		try {
			this.writeHttp(pending, error);
		} finally {
			this.releaseAll(pending);
		}
	}

	private writeHttp(pending: PendingHttp, error: unknown): void {
		const file = this.sink.fileFor(pending.context);
		if (!file) return;
		const redactor = this.sink.redactor;
		const now = performance.now();
		const url = redactor.url(`${pending.origin}${pending.path}`);
		let host = "";
		try {
			host = new URL(pending.origin).host;
		} catch {
			host = pending.origin;
		}
		const requestData =
			pending.requestChunks.length > 0
				? Buffer.concat(pending.requestChunks)
				: (pending.initialBody ?? Buffer.alloc(0));
		const payloadSha1 = pending.context?.modelRequestId
			? this.sink.payloadSha1(pending.context.modelRequestId)
			: undefined;
		const errorMessage =
			error === undefined ? undefined : error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		const record: HttpRecord = {
			type: "http",
			id: pending.id,
			t: pending.t,
			...(pending.context?.sessionId ? { sessionId: pending.context.sessionId } : {}),
			...(pending.context?.modelRequestId ? { modelRequestId: pending.context.modelRequestId } : {}),
			method: pending.method,
			url,
			host,
			requestHeaders: redactor.headers(pending.headers),
			requestBody: this.storeBody(file, `${pending.id}-request`, requestData, pending.headers, {
				truncated: pending.requestTruncated,
				wireBytes: pending.bytesOut || requestData.length,
				payloadSha1,
				note: pending.note,
			}),
			...(pending.status !== undefined ? { status: pending.status } : {}),
			...(pending.statusText ? { statusText: pending.statusText } : {}),
			...(pending.responseHeaders ? { responseHeaders: redactor.headers(pending.responseHeaders) } : {}),
			responseBody: this.storeBody(
				file,
				`${pending.id}-response`,
				Buffer.concat(pending.responseChunks),
				pending.responseHeaders,
				{
					truncated: pending.responseTruncated,
					wireBytes: pending.bytesIn,
					note: pending.note,
				},
			),
			timing: {
				...(pending.connectMs !== undefined ? { connectMs: round(pending.connectMs) } : {}),
				...(pending.reusedConnection !== undefined ? { reusedConnection: pending.reusedConnection } : {}),
				...(pending.sendPerf !== undefined ? { sendMs: round(pending.sendPerf - pending.perf) } : {}),
				...(pending.headersPerf !== undefined ? { ttfbMs: round(pending.headersPerf - pending.perf) } : {}),
				totalMs: round(now - pending.perf),
			},
			network: pending.network,
			bytesOut: pending.bytesOut || requestData.length,
			bytesIn: pending.bytesIn,
			...(errorMessage ? { error: redactor.text(errorMessage) } : {}),
			...(error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message))
				? { aborted: true }
				: {}),
		};
		file.append(record);
	}

	// -------------------------------------------------------------------------
	// WebSocket
	// -------------------------------------------------------------------------

	private patchWebSocket(proto: { send: (data: unknown) => void }): void {
		if (this.patchedPrototypes.has(proto) || typeof proto.send !== "function") return;
		const original = proto.send;
		const capture = this;
		this.patchedPrototypes.add(proto);
		this.originalSends.set(proto, original);
		proto.send = function patchedSend(this: object, data: unknown) {
			try {
				capture.onWebSocketSend(this, data);
			} catch {
				// Ignore capture failures.
			}
			return original.call(this, data);
		};
	}

	private onWebSocketOpen(message: unknown): void {
		const { websocket, address, protocol, extensions, handshakeResponse } = message as {
			websocket?: object & { url?: string };
			address?: { address?: string; port?: number; family?: string };
			protocol?: string;
			extensions?: string;
			handshakeResponse?: { status?: number; headers?: unknown };
		};
		if (!websocket) return;
		const proto = Object.getPrototypeOf(websocket) as { send: (data: unknown) => void } | null;
		if (proto) this.patchWebSocket(proto);
		const exchange = this.exchangeFor(websocket);
		const headers: Record<string, string | string[]> = {};
		const raw = handshakeResponse?.headers;
		if (raw && typeof raw === "object") {
			for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
				const entryValue = (value as { value?: unknown })?.value ?? value;
				addHeader(headers, name, String(entryValue));
			}
		}
		const key = hostPathKey(String(websocket.url ?? ""));
		const handshakeRequest = this.upgradeNetwork.get(key);
		this.upgradeNetwork.delete(key);
		exchange.handshake = {
			status: handshakeResponse?.status,
			...(handshakeRequest ? { requestHeaders: handshakeRequest.requestHeaders } : {}),
			headers: this.sink.redactor.headers(headers),
			...(protocol ? { protocol } : {}),
			...(extensions ? { extensions } : {}),
		};
		// `address` is the local end of the socket; the remote end comes from the handshake request.
		exchange.network = {
			...handshakeRequest?.network,
			...(address?.address ? { localAddress: address.address } : {}),
			...(address?.port ? { localPort: address.port } : {}),
		};
	}

	private exchangeFor(socket: object): WebSocketExchange {
		let exchange = this.webSockets.get(socket);
		if (!exchange) {
			exchange = new WebSocketExchange(this, socket);
			this.webSockets.set(socket, exchange);
			// Sockets that never report close would otherwise stay referenced forever.
			if (this.webSockets.size > MAX_TRACKED_WEBSOCKETS) {
				const [oldest, oldestExchange] = this.webSockets.entries().next().value ?? [];
				oldestExchange?.flush();
				if (oldest) this.webSockets.delete(oldest);
			}
		}
		return exchange;
	}

	private onWebSocketSend(socket: object, data: unknown): void {
		this.exchangeFor(socket).send(this.sink.context(), data);
	}

	/** Write the current exchange of every socket that served this model request. */
	flushModelRequest(modelRequestId: string): void {
		for (const exchange of this.webSockets.values()) exchange.flushIf(modelRequestId);
	}

	flushWebSockets(): void {
		for (const exchange of this.webSockets.values()) exchange.flush();
	}

	forgetWebSocket(socket: object): void {
		this.webSockets.delete(socket);
	}

	writeWebSocket(context: TraceContext | undefined, build: (file: CaptureFile) => WebSocketRecord): void {
		const file = this.sink.fileFor(context);
		if (file) file.append(build(file));
	}

	get redactor(): Redactor {
		return this.sink.redactor;
	}

	get maxBodyBytes(): number {
		return this.sink.maxBodyBytes;
	}

	get budget(): MemoryBudget {
		return this.sink.budget;
	}

	newId(prefix: string): string {
		return this.sink.newId(prefix);
	}
}

function hostPathKey(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.host}${parsed.pathname}`;
	} catch {
		return url;
	}
}

function round(ms: number): number {
	return Math.round(ms * 10) / 10;
}

function frameText(data: unknown): { text: string; bytes: number } {
	if (typeof data === "string") return { text: data, bytes: Buffer.byteLength(data) };
	const buffer = toBuffer(data);
	if (buffer) return { text: `[binary ${buffer.length} bytes]`, bytes: buffer.length };
	if (data instanceof ArrayBuffer) return { text: `[binary ${data.byteLength} bytes]`, bytes: data.byteLength };
	return { text: "[binary frame]", bytes: 0 };
}

interface ExchangeState {
	id: string;
	t: number;
	context: TraceContext | undefined;
	sent: string[];
	received: string[];
	framesSent: number;
	framesReceived: number;
	bytesOut: number;
	bytesIn: number;
	storedBytes: number;
	/** Bytes reserved from the shared in-flight budget. */
	reserved: number;
	truncated: boolean;
}

/**
 * Frames of one WebSocket, grouped into exchanges: a new exchange starts when the socket sends
 * on behalf of a different model request, so a reused socket yields one record per request.
 */
class WebSocketExchange {
	private readonly capture: NetworkCapture;
	private readonly url: string;
	handshake: WebSocketRecord["handshake"];
	network: NetworkInfo | undefined;
	private current: ExchangeState | undefined;
	private listening = false;

	constructor(capture: NetworkCapture, socket: object) {
		this.capture = capture;
		this.url = String((socket as { url?: unknown }).url ?? "");
		const target = socket as {
			addEventListener?: (type: string, listener: (event: unknown) => void) => void;
		};
		if (typeof target.addEventListener === "function" && !this.listening) {
			this.listening = true;
			target.addEventListener("message", (event) => {
				try {
					this.receive((event as { data?: unknown }).data);
				} catch {
					// Ignore capture failures.
				}
			});
			target.addEventListener("close", (event) => {
				try {
					this.flush((event as { code?: number }).code);
				} catch {
					// Ignore capture failures.
				}
				capture.forgetWebSocket(socket);
			});
		}
	}

	private start(context: TraceContext | undefined): ExchangeState {
		this.current = {
			id: this.capture.newId("w"),
			t: Date.now(),
			context,
			sent: [],
			received: [],
			framesSent: 0,
			framesReceived: 0,
			bytesOut: 0,
			bytesIn: 0,
			storedBytes: 0,
			reserved: 0,
			truncated: false,
		};
		return this.current;
	}

	private add(state: ExchangeState, list: string[], data: unknown): number {
		const frame = frameText(data);
		// Check the raw size first, so an oversized frame is never serialized or copied.
		if (state.truncated || state.storedBytes + frame.bytes > this.capture.maxBodyBytes) {
			state.truncated = true;
			return frame.bytes;
		}
		const line = JSON.stringify({ t: Date.now(), data: frame.text });
		const bytes = Buffer.byteLength(line);
		if (state.storedBytes + bytes > this.capture.maxBodyBytes || !this.capture.budget.tryReserve(bytes)) {
			state.truncated = true;
			return frame.bytes;
		}
		list.push(line);
		state.storedBytes += bytes;
		state.reserved += bytes;
		return frame.bytes;
	}

	send(context: TraceContext | undefined, data: unknown): void {
		let state = this.current;
		if (state && state.context?.modelRequestId !== context?.modelRequestId) {
			this.flush();
			state = undefined;
		}
		state ??= this.start(context);
		state.framesSent++;
		state.bytesOut += this.add(state, state.sent, data);
	}

	receive(data: unknown): void {
		const state = this.current ?? this.start(undefined);
		state.framesReceived++;
		state.bytesIn += this.add(state, state.received, data);
	}

	flushIf(modelRequestId: string): void {
		if (this.current?.context?.modelRequestId === modelRequestId) this.flush();
	}

	flush(closeCode?: number): void {
		const state = this.current;
		this.current = undefined;
		if (!state) return;
		try {
			this.write(state, closeCode);
		} finally {
			this.capture.budget.release(state.reserved);
			state.reserved = 0;
			state.sent = [];
			state.received = [];
		}
	}

	private write(state: ExchangeState, closeCode: number | undefined): void {
		if (state.framesSent === 0 && state.framesReceived === 0) return;
		const redactor = this.capture.redactor;
		let host = "";
		try {
			host = new URL(this.url).host;
		} catch {
			host = this.url;
		}
		this.capture.writeWebSocket(state.context, (file) => ({
			type: "websocket",
			id: state.id,
			t: state.t,
			...(state.context?.sessionId ? { sessionId: state.context.sessionId } : {}),
			...(state.context?.modelRequestId ? { modelRequestId: state.context.modelRequestId } : {}),
			url: redactor.url(this.url),
			host,
			...(this.handshake ? { handshake: this.handshake } : {}),
			...(this.network ? { network: this.network } : {}),
			sent: file.body(
				`${state.id}-sent`,
				redactor.text(state.sent.join("\n")),
				state.truncated ? { truncated: true } : {},
			),
			received: file.body(
				`${state.id}-received`,
				redactor.text(state.received.join("\n")),
				state.truncated ? { truncated: true } : {},
			),
			framesSent: state.framesSent,
			framesReceived: state.framesReceived,
			bytesOut: state.bytesOut,
			bytesIn: state.bytesIn,
			endedAt: Date.now(),
			...(closeCode !== undefined ? { closeCode } : {}),
		}));
	}
}
