/**
 * `/remote`: serves the running interactive session to a browser on another computer. Listens on
 * all interfaces, so every API request needs the per-run token from the printed URL as a Bearer
 * header. Prompts from the browser go through the same path as prompts typed in the terminal.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@akramcode/agent-core";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.ts";

const SSE_HEARTBEAT_MS = 25_000;
const PARTIAL_THROTTLE_MS = 150;
const MAX_EVENT_CLIENTS = 16;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_MESSAGES = 300;
const MAX_TOOL_TEXT = 4000;
const MAX_TOOL_ARGS = 2000;

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

/** A transcript message reduced to what the browser renders. */
export type RemoteMessage =
	| { role: "user"; text: string }
	| {
			role: "assistant";
			text: string;
			thinking: string;
			tools: { id: string; name: string; args: string }[];
			error?: string;
	  }
	| { role: "tool"; toolCallId: string; name: string; text: string; isError: boolean };

export type RemoteEvent =
	| { type: "reset" }
	| { type: "status"; busy: boolean }
	| { type: "partial"; message: RemoteMessage }
	| { type: "message"; message: RemoteMessage };

export interface RemoteControlHost {
	/** The current session; changes on /clear, resume, and fork. */
	session(): AgentSession;
	/** Submit text as if it was typed in the terminal editor. */
	submit(text: string): Promise<void>;
}

export interface RemoteControlOptions {
	host: RemoteControlHost;
	/** Directory with index.html, app.js, and app.css. */
	uiDir: string;
	/** 0 picks a free port. */
	port?: number;
	/** Interface to listen on. Default: all interfaces. */
	hostname?: string;
	/** Access token. Default: 32 random bytes, hex encoded, new for every run. */
	token?: string;
}

export interface RemoteControlServer {
	/** URLs with the access token, one per non-internal IPv4 address (loopback when there is none). */
	readonly urls: string[];
	readonly token: string;
	readonly port: number;
	/** Resubscribe after the host replaced its session, and tell browsers to reload the transcript. */
	sessionChanged(): void;
	close(): Promise<void>;
}

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text;
}

export function toRemoteMessage(message: AgentMessage): RemoteMessage | undefined {
	if (message.role === "user") {
		const text =
			typeof message.content === "string"
				? message.content
				: message.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n");
		return { role: "user", text };
	}
	if (message.role === "assistant") {
		let text = "";
		let thinking = "";
		const tools: { id: string; name: string; args: string }[] = [];
		for (const block of message.content) {
			if (block.type === "text") text += block.text;
			else if (block.type === "thinking") thinking += block.thinking;
			else
				tools.push({ id: block.id, name: block.name, args: clip(JSON.stringify(block.arguments), MAX_TOOL_ARGS) });
		}
		return {
			role: "assistant",
			text,
			thinking,
			tools,
			error: message.stopReason === "error" ? message.errorMessage : undefined,
		};
	}
	if (message.role === "toolResult") {
		const text = message.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n");
		return {
			role: "tool",
			toolCallId: message.toolCallId,
			name: message.toolName,
			text: clip(text, MAX_TOOL_TEXT),
			isError: message.isError,
		};
	}
	return undefined;
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
	res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type, "Content-Length": Buffer.byteLength(body) });
	res.end(res.req.method === "HEAD" ? undefined : body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
	send(res, status, "application/json; charset=utf-8", JSON.stringify(value));
}

function tokenMatches(candidate: string | undefined, token: Buffer): boolean {
	if (!candidate) return false;
	const given = Buffer.from(candidate);
	// timingSafeEqual needs equal lengths; a length mismatch is a failure without comparing contents.
	return given.length === token.length && timingSafeEqual(given, token);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
		chunks.push(chunk as Buffer);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function addresses(): string[] {
	const result: string[] = [];
	for (const entries of Object.values(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family === "IPv4" && !entry.internal) result.push(entry.address);
		}
	}
	return result.length > 0 ? result : ["127.0.0.1"];
}

export async function startRemoteControl(options: RemoteControlOptions): Promise<RemoteControlServer> {
	const { host, uiDir } = options;
	const token = options.token ?? randomBytes(32).toString("hex");
	const tokenBuffer = Buffer.from(token);
	const clients = new Set<ServerResponse>();

	const broadcast = (event: RemoteEvent) => {
		const payload = `data: ${JSON.stringify(event)}\n\n`;
		for (const client of clients) client.write(payload);
	};

	let partialTimer: NodeJS.Timeout | undefined;
	let pendingPartial: AgentMessage | undefined;
	const flushPartial = () => {
		partialTimer = undefined;
		const message = pendingPartial && toRemoteMessage(pendingPartial);
		pendingPartial = undefined;
		if (message) broadcast({ type: "partial", message });
	};

	const onEvent = (event: AgentSessionEvent) => {
		if (event.type === "agent_start") broadcast({ type: "status", busy: true });
		else if (event.type === "agent_settled") broadcast({ type: "status", busy: false });
		else if (event.type === "message_update" && event.message.role === "assistant") {
			pendingPartial = event.message;
			partialTimer ??= setTimeout(flushPartial, PARTIAL_THROTTLE_MS);
		} else if (event.type === "message_end") {
			clearTimeout(partialTimer);
			partialTimer = undefined;
			pendingPartial = undefined;
			const message = toRemoteMessage(event.message);
			if (message) broadcast({ type: "message", message });
		}
	};
	let unsubscribe = host.session().subscribe(onEvent);

	const snapshot = () => {
		const session = host.session();
		const model = session.model;
		return {
			cwd: session.cwd,
			name: session.sessionName,
			model: model ? `${model.provider}/${model.id}` : undefined,
			busy: session.isStreaming,
			messages: session.messages
				.slice(-MAX_SNAPSHOT_MESSAGES)
				.map(toRemoteMessage)
				.filter((message) => message !== undefined),
		};
	};

	const handleApi = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
		if (req.method === "GET" && path === "/api/state") {
			sendJson(res, 200, snapshot());
			return;
		}
		if (req.method === "GET" && path === "/api/events") {
			if (clients.size >= MAX_EVENT_CLIENTS) {
				sendJson(res, 429, { error: "Too many connections" });
				return;
			}
			res.writeHead(200, {
				...SECURITY_HEADERS,
				"Content-Type": "text/event-stream; charset=utf-8",
				Connection: "keep-alive",
			});
			res.write(": connected\n\n");
			clients.add(res);
			req.on("close", () => clients.delete(res));
			return;
		}
		if (req.method === "POST" && path === "/api/prompt") {
			const body = await readJsonBody(req);
			const text =
				typeof body === "object" && body !== null && "text" in body && typeof body.text === "string"
					? body.text.trim()
					: "";
			if (!text) {
				sendJson(res, 400, { error: "Empty prompt" });
				return;
			}
			await host.submit(text);
			sendJson(res, 200, { ok: true });
			return;
		}
		if (req.method === "POST" && path === "/api/abort") {
			await host.session().abort();
			sendJson(res, 200, { ok: true });
			return;
		}
		sendJson(res, 404, { error: "Not found" });
	};

	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://remote");
		// The static shell holds no data and is served without a token.
		const asset = UI_FILES[url.pathname];
		if (asset && (req.method === "GET" || req.method === "HEAD")) {
			try {
				send(res, 200, asset.type, readFileSync(join(uiDir, asset.file)));
			} catch {
				sendJson(res, 500, { error: "Remote UI asset missing" });
			}
			return;
		}
		// No cookie: a Bearer header is never attached by the browser on its own, so other sites
		// cannot make requests with it, and the token in the URL fragment never reaches the server.
		const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
		if (!tokenMatches(bearer, tokenBuffer)) {
			sendJson(res, 401, { error: "Missing or invalid token. Open the URL printed by /remote." });
			return;
		}
		handleApi(req, res, url.pathname).catch((error: unknown) => {
			if (res.headersSent) {
				res.destroy();
				return;
			}
			sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
		});
	});

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(options.port ?? 0, options.hostname ?? "0.0.0.0", () => {
			server.off("error", rejectListen);
			resolveListen();
		});
	});
	const port = (server.address() as AddressInfo).port;

	const heartbeat = setInterval(() => {
		for (const client of clients) client.write(": ping\n\n");
	}, SSE_HEARTBEAT_MS);
	heartbeat.unref();

	return {
		urls: addresses().map((address) => `http://${address}:${port}/#token=${token}`),
		token,
		port,
		sessionChanged: () => {
			unsubscribe();
			unsubscribe = host.session().subscribe(onEvent);
			broadcast({ type: "reset" });
		},
		close: async () => {
			unsubscribe();
			clearTimeout(partialTimer);
			clearInterval(heartbeat);
			for (const client of clients) client.end();
			clients.clear();
			server.closeAllConnections();
			await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
		},
	};
}
