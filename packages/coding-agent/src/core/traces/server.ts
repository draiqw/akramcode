/**
 * Local read-only HTTP server for `akramcode traces`. Binds to 127.0.0.1, serves the single-page
 * UI and a JSON API over the {@link TraceStore}, and pushes change notifications over SSE.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, join } from "node:path";
import {
	aggregateSummaries,
	filterSummaries,
	parseTraceFilter,
	type TraceFilter,
	type TraceSessionSummary,
	toListItem,
} from "./analyze.ts";
import { httpDetail, modelRequestDetail, sessionCapture, toolDetail, webSocketDetail } from "./capture-api.ts";
import type { CaptureStore, NetworkFilter } from "./capture-store.ts";
import type { TraceStore } from "./store.ts";

export const TRACES_HOST = "127.0.0.1";
const DEFAULT_POLL_INTERVAL_MS = 2000;
const SSE_HEARTBEAT_MS = 25_000;
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 5000;
const MAX_EVENT_CLIENTS = 32;

const UI_FILES: Record<string, { file: string; type: string }> = {
	"/": { file: "index.html", type: "text/html; charset=utf-8" },
	"/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
	"/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
	"/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
};

const SECURITY_HEADERS: Record<string, string> = {
	"Content-Security-Policy":
		"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
	"Cache-Control": "no-store",
	"Cross-Origin-Resource-Policy": "same-origin",
};

export interface TracesServerOptions {
	store: TraceStore;
	/** Directory with index.html, app.js, and app.css. */
	uiDir: string;
	/** 0 picks a free port. */
	port?: number;
	/** Re-scan interval for live updates. 0 disables polling. */
	pollIntervalMs?: number;
	/** Captured requests, network activity, and tool executions (`<agentDir>/traces`). */
	capture?: CaptureStore;
	/** Access token. Default: 32 random bytes, hex encoded, new for every run. */
	token?: string;
}

export interface TracesServer {
	/** URL with the access token, to open in a browser. */
	readonly url: string;
	/** URL without the token. */
	readonly baseUrl: string;
	readonly token: string;
	readonly port: number;
	readonly server: Server;
	close(): Promise<void>;
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
	res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type, "Content-Length": Buffer.byteLength(body) });
	res.end(res.req.method === "HEAD" ? undefined : body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
	send(res, status, "application/json; charset=utf-8", JSON.stringify(value));
}

/** Write a chunk and wait for the socket to drain when its buffer is full. */
async function write(res: ServerResponse, chunk: string): Promise<void> {
	if (res.destroyed) return;
	if (!res.write(chunk)) {
		await new Promise<void>((resolveDrain) => {
			const done = () => {
				res.off("drain", done);
				res.off("close", done);
				resolveDrain();
			};
			res.once("drain", done);
			res.once("close", done);
		});
	}
}

function sendError(res: ServerResponse, status: number, message: string): void {
	sendJson(res, status, { error: message });
}

function attachmentName(name: string): string {
	return `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}"`;
}

function tokenMatches(candidate: string | undefined, token: Buffer): boolean {
	if (!candidate) return false;
	const given = Buffer.from(candidate);
	// timingSafeEqual needs equal lengths; a length mismatch is a failure without comparing contents.
	return given.length === token.length && timingSafeEqual(given, token);
}

/** Only accept the loopback host names this server is reachable under; blocks DNS rebinding. */
function isAllowedHost(host: string | undefined, port: number): boolean {
	if (!host) return false;
	return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

function parseNetworkFilter(params: URLSearchParams): NetworkFilter {
	const filter: NetworkFilter = {};
	const q = params.get("q")?.trim();
	if (q) filter.q = q;
	for (const key of ["host", "provider", "sessionId"] as const) {
		const value = params.get(key);
		if (value) filter[key] = value;
	}
	const status = params.get("status");
	if (
		status === "2xx" ||
		status === "3xx" ||
		status === "4xx" ||
		status === "5xx" ||
		status === "error" ||
		status === "none"
	) {
		filter.status = status;
	}
	if (params.get("errors") === "1") filter.errors = true;
	const slow = Number(params.get("slowMs"));
	if (Number.isFinite(slow) && slow > 0) filter.slowMs = slow;
	const parsed = parseTraceFilter(params);
	if (parsed.from !== undefined) filter.from = parsed.from;
	if (parsed.to !== undefined) filter.to = parsed.to;
	return filter;
}

function facets(summaries: readonly TraceSessionSummary[]) {
	const projects = new Map<string, number>();
	const models = new Map<string, number>();
	for (const summary of summaries) {
		projects.set(summary.cwd, (projects.get(summary.cwd) ?? 0) + 1);
		for (const model of summary.models) models.set(model, (models.get(model) ?? 0) + 1);
	}
	const toList = (map: Map<string, number>) =>
		[...map.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
	return { projects: toList(projects), models: toList(models) };
}

function readUiFile(uiDir: string, file: string): Buffer | undefined {
	try {
		return readFileSync(join(uiDir, file));
	} catch {
		return undefined;
	}
}

export async function startTracesServer(options: TracesServerOptions): Promise<TracesServer> {
	const { store, uiDir, capture } = options;
	const token = options.token ?? randomBytes(32).toString("hex");
	const tokenBuffer = Buffer.from(token);
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const clients = new Set<ServerResponse>();
	let port = 0;

	const version = () => store.version + (capture?.version ?? 0);
	const broadcast = () => {
		const payload = `event: version\ndata: ${JSON.stringify({ version: version(), sessions: store.getSummaries().length })}\n\n`;
		for (const client of clients) client.write(payload);
	};

	const filtered = (filter: TraceFilter) => filterSummaries(store.getSummaries(), filter);

	const handleExport = async (res: ServerResponse, summaries: readonly TraceSessionSummary[], filter: TraceFilter) => {
		res.writeHead(200, {
			...SECURITY_HEADERS,
			"Content-Type": "application/json; charset=utf-8",
			"Content-Disposition": attachmentName(`akramcode-traces-${new Date().toISOString().slice(0, 10)}.json`),
		});
		res.write(
			`{"exportedAt":${JSON.stringify(new Date().toISOString())},"filter":${JSON.stringify(filter)},"sessions":[`,
		);
		let first = true;
		for (const summary of summaries) {
			if (res.destroyed) return;
			if (!first) await write(res, ",");
			first = false;
			await writeSessionExport(res, summary.key, { summary: toListItem(summary) });
		}
		res.end("]}");
	};

	/** Write `{...prefix, "entries": [...]}` for one session, streaming its lines with backpressure. */
	const writeSessionExport = async (res: ServerResponse, key: string, prefix: Record<string, unknown>) => {
		await write(res, `${JSON.stringify(prefix).slice(0, -1)},"entries":[`);
		let firstEntry = true;
		for await (const line of store.entryLines(key)) {
			if (res.destroyed) return;
			await write(res, firstEntry ? line : `,${line}`);
			firstEntry = false;
		}
		await write(res, "]}");
	};

	const handleApi = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> => {
		await store.ready();
		if (capture && capture.version === 0) await capture.refresh();
		const path = url.pathname;
		if (path.startsWith("/api/network") || path.startsWith("/api/capture/")) {
			await handleCapture(res, url);
			return;
		}
		const filter = parseTraceFilter(url.searchParams);

		if (path === "/api/version") {
			sendJson(res, 200, { version: version(), sessions: store.getSummaries().length, roots: store.roots });
			return;
		}
		if (path === "/api/facets") {
			sendJson(res, 200, facets(store.getSummaries()));
			return;
		}
		if (path === "/api/sessions") {
			const all = filtered(filter);
			const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
			const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_PAGE_SIZE));
			sendJson(res, 200, {
				version: version(),
				total: all.length,
				offset,
				sessions: all.slice(offset, offset + limit).map(toListItem),
			});
			return;
		}
		if (path === "/api/aggregate") {
			sendJson(res, 200, { version: version(), ...aggregateSummaries(filtered(filter)) });
			return;
		}
		if (path === "/api/export") {
			await handleExport(res, filtered(filter), filter);
			return;
		}
		if (path === "/api/events") {
			if (clients.size >= MAX_EVENT_CLIENTS) {
				sendError(res, 429, "Too many live-update connections");
				return;
			}
			res.writeHead(200, {
				...SECURITY_HEADERS,
				"Content-Type": "text/event-stream; charset=utf-8",
				Connection: "keep-alive",
			});
			res.write(`retry: 3000\nevent: version\ndata: ${JSON.stringify({ version: version() })}\n\n`);
			clients.add(res);
			req.on("close", () => clients.delete(res));
			return;
		}

		const match = /^\/api\/sessions\/([0-9a-f]{16})(?:\/(raw|export|capture))?$/.exec(path);
		if (match) {
			const key = match[1];
			const action = match[2];
			const filePath = store.getPath(key);
			if (!filePath) {
				sendError(res, 404, "Session not found");
				return;
			}
			if (action === "raw") {
				// Serve only regular files whose real path is inside a session root.
				const safePath = await store.resolveServablePath(key);
				if (!safePath) {
					sendError(res, 404, "Session not found");
					return;
				}
				res.writeHead(200, {
					...SECURITY_HEADERS,
					"Content-Type": "application/octet-stream",
					"Content-Disposition": attachmentName(basename(filePath)),
				});
				const stream = createReadStream(safePath);
				stream.on("error", () => res.destroy());
				stream.pipe(res);
				return;
			}
			if (action === "capture") {
				const summary = store.getSummary(key);
				if (!summary) {
					sendError(res, 404, "Session not found");
					return;
				}
				sendJson(
					res,
					200,
					capture
						? sessionCapture(capture, summary.sessionId, { from: summary.startedAt, to: summary.lastActivityAt })
						: { files: [], modelRequests: [], tools: [], otherActivity: [] },
				);
				return;
			}
			if (action === "export") {
				const summary = store.getListItem(key);
				if (!summary) {
					sendError(res, 404, "Session not found");
					return;
				}
				res.writeHead(200, {
					...SECURITY_HEADERS,
					"Content-Type": "application/json; charset=utf-8",
					"Content-Disposition": attachmentName(`${basename(filePath, ".jsonl")}.json`),
				});
				await writeSessionExport(res, key, { exportedAt: new Date().toISOString(), summary });
				res.end();
				return;
			}
			const detail = await store.getDetail(key);
			if (!detail) {
				sendError(res, 404, "Session not found");
				return;
			}
			const related = (keys: readonly (string | undefined)[]) =>
				keys.flatMap((relatedKey) => {
					const item = relatedKey ? store.getListItem(relatedKey) : undefined;
					return item ? [item] : [];
				});
			sendJson(res, 200, {
				version: version(),
				summary: detail.summary,
				events: detail.events,
				parent: related([detail.summary.parentKey])[0],
				forkParent: related([detail.summary.forkParentKey])[0],
				children: related(detail.summary.childKeys),
			});
			return;
		}
		sendError(res, 404, "Not found");
	};

	const handleCapture = async (res: ServerResponse, url: URL): Promise<void> => {
		const path = url.pathname;
		if (!capture) {
			sendError(res, 404, "Capture is not available");
			return;
		}
		if (path === "/api/network") {
			const result = capture.listNetwork(parseNetworkFilter(url.searchParams));
			const keyFor = (sessionId: string | undefined) => (sessionId ? store.keyForSessionId(sessionId) : undefined);
			sendJson(res, 200, {
				version: version(),
				total: result.total,
				items: result.items.map((item) => ({ ...item, sessionKey: keyFor(item.sessionId) })),
			});
			return;
		}
		if (path === "/api/network/facets") {
			sendJson(res, 200, capture.networkFacets());
			return;
		}
		const id = "([A-Za-z0-9_-]{1,80})";
		const fileKey = "([0-9a-f]{16})";
		let match = new RegExp(`^/api/capture/model/${id}$`).exec(path);
		if (match) {
			const detail = await modelRequestDetail(capture, match[1]);
			if (detail) sendJson(res, 200, detail);
			else sendError(res, 404, "Request not found");
			return;
		}
		match = new RegExp(`^/api/capture/(http|ws|tool)/${fileKey}/${id}$`).exec(path);
		if (match) {
			const [, kind, key, recordId] = match;
			const detail =
				kind === "http"
					? await httpDetail(capture, key, recordId)
					: kind === "ws"
						? await webSocketDetail(capture, key, recordId)
						: await toolDetail(capture, key, recordId);
			if (detail) sendJson(res, 200, detail);
			else sendError(res, 404, "Record not found");
			return;
		}
		match = new RegExp(`^/api/capture/blob/${fileKey}/([A-Za-z0-9_-][A-Za-z0-9._-]{0,199})$`).exec(path);
		if (match) {
			const blobPath = await capture.resolveBlobPath(match[1], match[2]);
			if (!blobPath) {
				sendError(res, 404, "Blob not found");
				return;
			}
			res.writeHead(200, {
				...SECURITY_HEADERS,
				"Content-Type": "application/octet-stream",
				"Content-Disposition": attachmentName(match[2]),
			});
			const stream = createReadStream(blobPath);
			stream.on("error", () => res.destroy());
			stream.pipe(res);
			return;
		}
		sendError(res, 404, "Not found");
	};

	const server = createServer((req, res) => {
		if (!isAllowedHost(req.headers.host, port)) {
			sendError(res, 403, "Forbidden host");
			return;
		}
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.setHeader("Allow", "GET, HEAD");
			sendError(res, 405, "Read-only server");
			return;
		}
		const url = new URL(req.url ?? "/", `http://${TRACES_HOST}`);
		// A token in the query string would land in history, logs, and Referer headers; the token
		// travels only in the URL fragment (read by the page) and the Authorization header.
		if (url.searchParams.has("token")) {
			sendError(res, 400, "Tokens are not accepted in the query string. Open the URL printed by akramcode traces.");
			return;
		}
		// The static shell holds no data and is served without a token.
		const asset = UI_FILES[url.pathname];
		if (asset) {
			const body = readUiFile(uiDir, asset.file);
			if (!body) {
				sendError(res, 500, "Traces UI asset missing");
				return;
			}
			send(res, 200, asset.type, body);
			return;
		}
		if (!url.pathname.startsWith("/api/")) {
			sendError(res, 404, "Not found");
			return;
		}
		// Other local users can reach 127.0.0.1 and the API serves full model payloads, so every API
		// request needs the per-run token as a Bearer header. No cookie: cookies are not scoped to a
		// port, so a browser would send one to every other server on 127.0.0.1.
		const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
		if (!tokenMatches(bearer, tokenBuffer)) {
			sendError(res, 401, "Missing or invalid token. Open the URL printed by akramcode traces.");
			return;
		}
		handleApi(req, res, url).catch((error: unknown) => {
			if (res.headersSent) {
				res.destroy();
				return;
			}
			sendError(res, 500, error instanceof Error ? error.message : String(error));
		});
	});

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(options.port ?? 0, TRACES_HOST, () => {
			server.off("error", rejectListen);
			resolveListen();
		});
	});
	port = (server.address() as AddressInfo).port;

	let timer: NodeJS.Timeout | undefined;
	const poll = async () => {
		try {
			const sessionsChanged = await store.refresh();
			const captureChanged = capture ? await capture.refresh() : false;
			if (sessionsChanged || captureChanged) broadcast();
		} catch {
			// A failed scan keeps the previous index; the next poll retries.
		}
	};
	if (pollIntervalMs > 0) timer = setInterval(() => void poll(), pollIntervalMs);
	const heartbeat = setInterval(() => {
		for (const client of clients) client.write(": ping\n\n");
	}, SSE_HEARTBEAT_MS);
	heartbeat.unref();

	return {
		url: `http://${TRACES_HOST}:${port}/#token=${token}`,
		baseUrl: `http://${TRACES_HOST}:${port}/`,
		token,
		port,
		server,
		close: async () => {
			if (timer) clearInterval(timer);
			clearInterval(heartbeat);
			for (const client of clients) client.end();
			clients.clear();
			server.closeAllConnections();
			await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
		},
	};
}
