/**
 * Public relay for `/remote`, deployed on a server with a public address. A computer running
 * AkramCode holds an outgoing event stream to the relay and receives browser requests over it;
 * it answers each one with a streaming POST that the relay pipes to the browser. The relay never
 * checks the session token: the AkramCode session does. The relay key only decides who may offer
 * sessions, so the relay cannot serve arbitrary content to strangers.
 *
 * Self-contained (node: imports only) so it runs as `RELAY_KEY=... node remote-relay.ts`.
 *
 * Routes:
 * - `GET /agent/<room>` (relay key): the computer's request stream.
 * - `POST /agent/<room>/reply/<id>` (relay key): the response to one browser request.
 * - `/r/<room>/<path>`: browser requests, forwarded to the computer as `/<path>`.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

const HEARTBEAT_MS = 25_000;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_PENDING_PER_ROOM = 64;
/** A browser request the computer has not started answering in this time fails with 504. */
const REPLY_TIMEOUT_MS = 30_000;
const ROOM_PATTERN = "[0-9a-f]{32}";

/** Browser request headers forwarded to the computer. */
const FORWARDED_REQUEST_HEADERS = ["authorization", "content-type", "accept"];
/** Computer response headers passed through to the browser. */
const FORWARDED_RESPONSE_HEADERS = new Set([
	"content-type",
	"cache-control",
	"content-security-policy",
	"x-content-type-options",
	"referrer-policy",
	"cross-origin-resource-policy",
]);

/** One frame of the computer's request stream. */
export type RelayFrame =
	| { type: "request"; id: string; method: string; path: string; headers: Record<string, string>; body?: string }
	| { type: "cancel"; id: string };

interface PendingRequest {
	res: ServerResponse;
	timer: NodeJS.Timeout;
	reply?: IncomingMessage;
}

interface Room {
	stream: ServerResponse;
	pending: Map<string, PendingRequest>;
}

export interface RelayServerOptions {
	/** Key that computers present to offer a session. */
	key: string;
	port?: number;
	hostname?: string;
}

export interface RelayServer {
	readonly port: number;
	readonly server: Server;
	close(): Promise<void>;
}

function sendText(res: ServerResponse, status: number, text: string): void {
	res.writeHead(status, {
		"Content-Type": "text/plain; charset=utf-8",
		"Content-Length": Buffer.byteLength(text),
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
	});
	res.end(text);
}

function keyMatches(req: IncomingMessage, key: Buffer): boolean {
	const given = Buffer.from(/^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1] ?? "");
	// timingSafeEqual needs equal lengths; a length mismatch is a failure without comparing contents.
	return given.length === key.length && timingSafeEqual(given, key);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks);
}

export async function startRelayServer(options: RelayServerOptions): Promise<RelayServer> {
	if (!options.key) throw new Error("Relay key is required");
	const key = Buffer.from(options.key);
	const rooms = new Map<string, Room>();

	const sendFrame = (room: Room, frame: RelayFrame) => {
		room.stream.write(`data: ${JSON.stringify(frame)}\n\n`);
	};

	const finishPending = (room: Room, id: string) => {
		const pending = room.pending.get(id);
		if (!pending) return undefined;
		clearTimeout(pending.timer);
		room.pending.delete(id);
		return pending;
	};

	const closeRoom = (roomId: string, room: Room) => {
		if (rooms.get(roomId) === room) rooms.delete(roomId);
		for (const id of [...room.pending.keys()]) {
			const pending = finishPending(room, id);
			if (!pending) continue;
			pending.reply?.destroy();
			if (!pending.res.headersSent) sendText(pending.res, 502, "The session disconnected.");
			else pending.res.destroy();
		}
		room.stream.end();
	};

	const handleAgentStream = (req: IncomingMessage, res: ServerResponse, roomId: string) => {
		const previous = rooms.get(roomId);
		if (previous) closeRoom(roomId, previous);
		res.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-store",
			Connection: "keep-alive",
		});
		res.write(": connected\n\n");
		const room: Room = { stream: res, pending: new Map() };
		rooms.set(roomId, room);
		req.on("close", () => closeRoom(roomId, room));
	};

	const handleReply = (req: IncomingMessage, res: ServerResponse, roomId: string, id: string) => {
		const room = rooms.get(roomId);
		const pending = room?.pending.get(id);
		if (!room || !pending || pending.reply) {
			req.resume();
			sendText(res, 404, "Unknown request");
			return;
		}
		clearTimeout(pending.timer);
		pending.reply = req;
		const status = Number(req.headers["x-relay-status"]) || 502;
		let headers: Record<string, string> = {};
		try {
			const parsed: unknown = JSON.parse(String(req.headers["x-relay-headers"] ?? "{}"));
			if (typeof parsed === "object" && parsed !== null) {
				headers = Object.fromEntries(
					Object.entries(parsed).filter(
						(entry): entry is [string, string] =>
							FORWARDED_RESPONSE_HEADERS.has(entry[0].toLowerCase()) && typeof entry[1] === "string",
					),
				);
			}
		} catch {
			// Malformed headers: answer with the status and body only.
		}
		pending.res.writeHead(status, { ...headers, "X-Accel-Buffering": "no" });
		pending.res.flushHeaders();
		req.on("data", (chunk: Buffer) => pending.res.write(chunk));
		req.on("end", () => {
			finishPending(room, id);
			pending.res.end();
			sendText(res, 200, "ok");
		});
		req.on("error", () => {
			finishPending(room, id);
			pending.res.destroy();
		});
	};

	const handleBrowser = async (req: IncomingMessage, res: ServerResponse, roomId: string, path: string) => {
		const room = rooms.get(roomId);
		if (!room) {
			req.resume();
			sendText(res, 503, "This session is offline. Run /remote in AkramCode again.");
			return;
		}
		if (room.pending.size >= MAX_PENDING_PER_ROOM) {
			req.resume();
			sendText(res, 429, "Too many requests");
			return;
		}
		const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
		const headers: Record<string, string> = {};
		for (const name of FORWARDED_REQUEST_HEADERS) {
			const value = req.headers[name];
			if (typeof value === "string") headers[name] = value;
		}
		const id = randomBytes(12).toString("hex");
		const timer = setTimeout(() => {
			if (finishPending(room, id)) sendText(res, 504, "The session did not answer.");
		}, REPLY_TIMEOUT_MS);
		room.pending.set(id, { res, timer });
		res.on("close", () => {
			const pending = finishPending(room, id);
			if (!pending) return;
			pending.reply?.destroy();
			sendFrame(room, { type: "cancel", id });
		});
		sendFrame(room, {
			type: "request",
			id,
			method: req.method ?? "GET",
			path,
			headers,
			body: body && body.length > 0 ? body.toString("base64") : undefined,
		});
	};

	const agentStream = new RegExp(`^/agent/(${ROOM_PATTERN})$`);
	const agentReply = new RegExp(`^/agent/(${ROOM_PATTERN})/reply/([0-9a-f]{24})$`);
	const browser = new RegExp(`^/r/(${ROOM_PATTERN})(/.*)?$`);

	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://relay");
		let match = agentStream.exec(url.pathname);
		if (match || agentReply.test(url.pathname)) {
			if (!keyMatches(req, key)) {
				req.resume();
				sendText(res, 401, "Invalid relay key");
				return;
			}
			if (match && req.method === "GET") {
				handleAgentStream(req, res, match[1]!);
				return;
			}
			match = agentReply.exec(url.pathname);
			if (match && req.method === "POST") {
				handleReply(req, res, match[1]!, match[2]!);
				return;
			}
			req.resume();
			sendText(res, 405, "Method not allowed");
			return;
		}
		match = browser.exec(url.pathname);
		if (match) {
			// The page loads its files and API with relative paths, so the room needs a trailing slash.
			if (!match[2]) {
				res.writeHead(308, { Location: `/r/${match[1]}/` });
				res.end();
				return;
			}
			handleBrowser(req, res, match[1]!, `${match[2]}${url.search}`).catch((error: unknown) => {
				if (!res.headersSent) sendText(res, 400, error instanceof Error ? error.message : String(error));
			});
			return;
		}
		req.resume();
		sendText(res, 404, "Not found");
	});
	// Request streams and event streams stay open; only the heartbeat keeps them alive.
	server.requestTimeout = 0;

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(options.port ?? 0, options.hostname ?? "0.0.0.0", () => {
			server.off("error", rejectListen);
			resolveListen();
		});
	});

	const heartbeat = setInterval(() => {
		for (const room of rooms.values()) room.stream.write(": ping\n\n");
	}, HEARTBEAT_MS);
	heartbeat.unref();

	return {
		port: (server.address() as AddressInfo).port,
		server,
		close: async () => {
			clearInterval(heartbeat);
			for (const [roomId, room] of [...rooms]) closeRoom(roomId, room);
			server.closeAllConnections();
			await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
		},
	};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const relay = await startRelayServer({ key: process.env.RELAY_KEY ?? "", port: Number(process.env.PORT) || 8080 });
	console.log(`remote relay listening on port ${relay.port}`);
	const stop = () => void relay.close().then(() => process.exit(0));
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);
}
