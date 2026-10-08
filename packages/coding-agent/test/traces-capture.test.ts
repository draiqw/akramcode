import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Api, Model } from "@akramcode/ai";
import { streamSimple } from "@akramcode/providers/compat";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTracesUiDir } from "../src/config.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { configureHttpDispatcher } from "../src/core/http-dispatcher.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import type { HttpRecord, ModelRequestRecord, ToolExecutionRecord } from "../src/core/traces/capture/format.ts";
import {
	DEFAULT_TRACE_CAPTURE_SETTINGS,
	getTraceRecorder,
	installTraceRecorder,
	resolveTraceCaptureSettings,
	uninstallTraceRecorder,
} from "../src/core/traces/capture/recorder.ts";
import { REDACTED, Redactor } from "../src/core/traces/capture/redact.ts";
import { enforceCaptureRetention } from "../src/core/traces/capture/writer.ts";
import { diffPayloads } from "../src/core/traces/capture-api.ts";
import { CaptureStore } from "../src/core/traces/capture-store.ts";
import { startTracesServer } from "../src/core/traces/server.ts";
import { TraceStore, traceKeyForPath } from "../src/core/traces/store.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";

const API_KEY = "sk-test-0123456789abcdefghijklmnopqrstuv";

function sse(chunks: unknown[]): string {
	return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
}

function chunk(choices: unknown[], extra: Record<string, unknown> = {}) {
	return { id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "local-model", choices, ...extra };
}

/** A minimal OpenAI-compatible server: the first turn calls bash, the second answers with text. */
function handleChat(body: string, res: ServerResponse): void {
	const request = JSON.parse(body) as { messages: Array<{ role: string }> };
	const afterTool = request.messages.some((message) => message.role === "tool");
	const events = afterTool
		? [
				chunk([{ index: 0, delta: { role: "assistant", content: "done after tool" }, finish_reason: null }]),
				chunk([{ index: 0, delta: {}, finish_reason: "stop" }]),
				chunk([], { usage: { prompt_tokens: 50, completion_tokens: 3, total_tokens: 53 } }),
			]
		: [
				chunk([
					{
						index: 0,
						delta: {
							role: "assistant",
							tool_calls: [
								{
									index: 0,
									id: "call_1",
									type: "function",
									function: { name: "bash", arguments: JSON.stringify({ command: "echo captured-output" }) },
								},
							],
						},
						finish_reason: null,
					},
				]),
				chunk([{ index: 0, delta: {}, finish_reason: "tool_calls" }]),
				chunk([], { usage: { prompt_tokens: 40, completion_tokens: 5, total_tokens: 45 } }),
			];
	res.writeHead(200, { "content-type": "text/event-stream", "set-cookie": "session=secret-cookie-value" });
	res.end(sse(events));
}

let server: Server;
let baseUrl: string;
const seenAuth: string[] = [];

beforeAll(async () => {
	// Production installs undici's fetch as the global fetch; capture relies on its channels.
	configureHttpDispatcher();
	server = createServer((req: IncomingMessage, res: ServerResponse) => {
		let body = "";
		req.on("data", (data: Buffer) => {
			body += data.toString("utf8");
		});
		req.on("end", () => {
			seenAuth.push(String(req.headers.authorization));
			if (req.url?.startsWith("/v1/chat/completions")) {
				handleChat(body, res);
			} else if (req.url?.startsWith("/gzip")) {
				res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
				res.end(
					gzipSync(
						JSON.stringify({
							ok: true,
							access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl",
						}),
					),
				);
			} else {
				res.writeHead(404, { "content-type": "text/plain" });
				res.end("not found");
			}
		});
	});
	// Minimal WebSocket echo endpoint: replies "echo:<text>" to every text frame.
	server.on("upgrade", (req, socket) => {
		const accept = createHash("sha1")
			.update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
			.digest("base64");
		socket.write(
			`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
		);
		socket.on("data", (data: Buffer) => {
			const opcode = data[0] & 0x0f;
			if (opcode === 0x8) {
				socket.end(Buffer.from([0x88, 0x00]));
				return;
			}
			let length = data[1] & 0x7f;
			let offset = 2;
			if (length === 126) {
				length = data.readUInt16BE(2);
				offset = 4;
			}
			const mask = data.subarray(offset, offset + 4);
			const payload = Buffer.from(
				data.subarray(offset + 4, offset + 4 + length).map((byte, i) => byte ^ mask[i % 4]),
			);
			const reply = Buffer.from(`echo:${payload.toString("utf8")}`);
			socket.write(Buffer.concat([Buffer.from([0x81, reply.length]), reply]));
		});
	});
	await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	server.closeAllConnections();
	await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
});

function readRecords(dir: string): Array<{ type: string } & Record<string, unknown>> {
	const records: Array<{ type: string } & Record<string, unknown>> = [];
	const walk = (path: string) => {
		for (const name of readdirSync(path, { withFileTypes: true })) {
			const full = join(path, name.name);
			if (name.isDirectory() && !name.name.endsWith(".blobs")) walk(full);
			else if (name.name.endsWith(".jsonl")) {
				for (const line of readFileSync(full, "utf8").split("\n")) if (line.trim()) records.push(JSON.parse(line));
			}
		}
	};
	walk(dir);
	return records;
}

describe("trace capture redaction", () => {
	it("redacts credential headers, URL secrets, and known key formats", () => {
		const redactor = new Redactor();
		const headers = redactor.headers({
			Authorization: `Bearer ${API_KEY}`,
			"x-api-key": "plain-secret-value-123",
			cookie: "a=b",
			"content-type": "application/json",
		});
		expect(headers.Authorization).toBe(`Bearer ${REDACTED} (${`Bearer ${API_KEY}`.length} chars)`);
		expect(headers["x-api-key"]).toContain(REDACTED);
		expect(headers.cookie).toContain(REDACTED);
		expect(headers["content-type"]).toBe("application/json");
		// A secret learned from a header is removed wherever it reappears.
		expect(redactor.text(`echo plain-secret-value-123`)).toBe(`echo ${REDACTED}`);
		expect(redactor.url("https://x.test/v1?key=AIzaSyA1234567890abcdefghijklmnopqrstu&alt=sse")).toBe(
			`https://x.test/v1?key=${encodeURIComponent(REDACTED)}&alt=sse`,
		);
		const body = redactor.text(
			'{"refresh_token":"abc.def","note":"key sk-ant-api03-abcdefghijklmnopqrstuvwxyz and ghp_abcdefghijklmnopqrstuvwxyz0123456789"}',
		);
		expect(body).not.toContain("abc.def");
		expect(body).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
		expect(body).not.toContain("sk-ant-api03-abcdefghijklmnopqrstuvwxyz");
		expect(redactor.text("grant_type=refresh_token&refresh_token=xyz123&client_id=app")).toBe(
			`grant_type=refresh_token&refresh_token=${REDACTED}&client_id=app`,
		);
		expect(redactor.text("exit code=1")).toBe("exit code=1");
	});

	it("resolves settings with environment override", () => {
		expect(resolveTraceCaptureSettings(undefined, "")).toEqual(DEFAULT_TRACE_CAPTURE_SETTINGS);
		expect(resolveTraceCaptureSettings({ enabled: true, maxAgeDays: 7 }, "0")).toMatchObject({
			enabled: false,
			maxAgeDays: 7,
		});
		expect(resolveTraceCaptureSettings({ enabled: false }, "1").enabled).toBe(true);
		expect(resolveTraceCaptureSettings({ maxTotalSizeMb: -5 }, "").maxTotalSizeMb).toBe(2048);
	});

	it("diffs consecutive payloads by common prefix", () => {
		const diff = diffPayloads(
			{ model: "a", messages: [{ role: "user", content: "hi" }], tools: [1] },
			{
				model: "a",
				messages: [
					{ role: "user", content: "hi" },
					{ role: "assistant", content: "yo" },
				],
				tools: [1],
				temperature: 1,
			},
		);
		expect(diff.unchanged.sort()).toEqual(["model", "tools"]);
		expect(diff.changed).toEqual([
			expect.objectContaining({ key: "messages", kind: "array", commonPrefix: 1, length: 2, removed: 0 }),
			expect.objectContaining({ key: "temperature", kind: "added" }),
		]);
	});
});

describe("trace capture retention", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "akramcode-capture-retention-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("deletes expired files and the oldest files over the size limit, keeping protected ones", async () => {
		const now = Date.now();
		const make = (name: string, ageDays: number, bytes: number) => {
			const path = join(dir, "sessions", name, "f.jsonl");
			mkdirSync(join(dir, "sessions", name), { recursive: true });
			writeFileSync(path, "x".repeat(bytes));
			mkdirSync(path.replace(/\.jsonl$/, ".blobs"));
			writeFileSync(join(path.replace(/\.jsonl$/, ".blobs"), "b.txt"), "y".repeat(bytes));
			const time = (now - ageDays * 86_400_000) / 1000;
			utimesSync(path, time, time);
			return path;
		};
		const expired = make("expired", 40, 10);
		const oldest = make("oldest", 5, 1000);
		const protectedOld = make("protected", 6, 1000);
		const newest = make("newest", 1, 1000);
		const deleted = await enforceCaptureRetention(dir, {
			maxAgeMs: 30 * 86_400_000,
			maxTotalBytes: 4500,
			protect: new Set([protectedOld]),
			now,
		});
		expect(deleted).toBe(2);
		const remaining = readRecordsPaths(dir);
		expect(remaining).toContain(protectedOld);
		expect(remaining).toContain(newest);
		expect(remaining).not.toContain(expired);
		expect(remaining).not.toContain(oldest);
	});
});

function readRecordsPaths(dir: string): string[] {
	const out: string[] = [];
	const walk = (path: string) => {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			const full = join(path, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".jsonl")) out.push(full);
		}
	};
	walk(dir);
	return out;
}

describe("trace capture of a session", () => {
	let root: string;
	let agentDir: string;
	let captureDir: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "akramcode-capture-"));
		agentDir = join(root, "agent");
		captureDir = join(agentDir, "traces");
		mkdirSync(agentDir, { recursive: true });
		installTraceRecorder({ agentDir, settings: { ...DEFAULT_TRACE_CAPTURE_SETTINGS }, appVersion: "test" });
	});

	afterEach(() => {
		uninstallTraceRecorder();
		rmSync(root, { recursive: true, force: true });
	});

	it("captures unscoped HTTP requests with decoded, redacted bodies and network details", async () => {
		const response = await fetch(`${baseUrl}/gzip?api_key=${API_KEY}`, {
			method: "POST",
			headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
			body: JSON.stringify({ hello: "world", key: API_KEY }),
		});
		expect(await response.json()).toMatchObject({ ok: true });
		const http = readRecords(captureDir).find((record) => record.type === "http") as unknown as HttpRecord;
		expect(http).toBeDefined();
		expect(http.sessionId).toBeUndefined();
		expect(http.url).not.toContain(API_KEY);
		expect(http.requestHeaders.authorization).toContain(REDACTED);
		expect(http.requestBody?.text).toContain('"hello":"world"');
		expect(http.requestBody?.text).not.toContain(API_KEY);
		expect(http.status).toBe(200);
		expect(http.responseBody?.contentEncoding).toBe("gzip");
		expect(http.responseBody?.text).toContain('"ok":true');
		expect(http.responseBody?.text).not.toContain("c2lnbmF0dXJlLXZhbHVl");
		expect(http.network.remoteAddress).toBe("127.0.0.1");
		expect(http.network.httpVersion).toBe("1.1");
		expect(http.timing.totalMs).toBeGreaterThan(0);
		expect(http.timing.ttfbMs).toBeDefined();
		expect(http.bytesIn).toBeGreaterThan(0);
		expect(JSON.stringify(readRecords(captureDir))).not.toContain(API_KEY);
	});

	it("captures WebSocket frames per model request", async () => {
		const recorder = getTraceRecorder()!;
		const socket = recorder.runInContext({ sessionId: "ws-session", modelRequestId: "m-ws-1" }, () => {
			const ws = new WebSocket(`${baseUrl.replace("http:", "ws:")}/socket`);
			ws.addEventListener("open", () => ws.send(`{"type":"response.create","key":"${API_KEY}"}`));
			return ws;
		});
		await new Promise<void>((resolveMessage) => socket.addEventListener("message", () => resolveMessage()));
		recorder.flushModelRequest("m-ws-1");
		socket.close();
		const ws = readRecords(captureDir).find((record) => record.type === "websocket") as unknown as {
			sessionId: string;
			modelRequestId: string;
			framesSent: number;
			framesReceived: number;
			sent: { text: string };
			received: { text: string };
			handshake: { status: number };
			network: { remoteAddress?: string };
		};
		expect(ws).toMatchObject({ sessionId: "ws-session", modelRequestId: "m-ws-1", framesSent: 1, framesReceived: 1 });
		expect(ws.sent.text).toContain("response.create");
		expect(ws.sent.text).not.toContain(API_KEY);
		expect(ws.received.text).toContain("echo:");
		expect(ws.handshake.status).toBe(101);
		expect(ws.network.remoteAddress).toBe("127.0.0.1");
	});

	it("records model requests, linked HTTP, tool executions, and serves them over the API", async () => {
		const model: Model<Api> = {
			id: "local-model",
			name: "Local",
			api: "openai-completions",
			provider: "capture-local",
			baseUrl: `${baseUrl}/v1`,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
		};
		const cwd = join(root, "project");
		const sessionsDir = join(root, "sessions");
		mkdirSync(cwd, { recursive: true });
		const settingsManager = SettingsManager.inMemory({});
		const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
		await resourceLoader.reload();
		const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
		await authStorage.modify(model.provider, async () => ({ type: "api_key", key: API_KEY }));
		const modelRegistry = await createModelRegistry(authStorage, join(agentDir, "models.json"));
		// The real OpenAI completions adapter talks to the local server.
		modelRegistry.registerProvider(model.provider, {
			api: model.api,
			streamSimple: (requestModel, context, options) =>
				streamSimple({ ...model, ...requestModel, baseUrl: model.baseUrl }, context, options),
		});
		const sessionManager = SessionManager.create(cwd, sessionsDir);
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model,
			modelRuntime: getModelRuntime(modelRegistry),
			settingsManager,
			sessionManager,
			resourceLoader,
			tools: ["bash"],
		});
		try {
			await session.prompt("run the command");
		} finally {
			session.dispose();
			modelRegistry.unregisterProvider(model.provider);
		}
		expect(getTraceRecorder()).toBeDefined();

		const records = readRecords(captureDir);
		const sessionId = sessionManager.getSessionId();
		const requests = records.filter((record) => record.type === "model_request") as unknown as ModelRequestRecord[];
		expect(requests).toHaveLength(2);
		expect(requests.every((request) => request.sessionId === sessionId)).toBe(true);
		expect(requests[0].payload?.text ?? "").toContain("run the command");
		expect(requests[0].eventCount).toBeGreaterThan(0);
		expect(requests[0].response?.status).toBe(200);
		expect(requests[1].stopReason).toBe("stop");

		const http = records.filter((record) => record.type === "http") as unknown as HttpRecord[];
		expect(http.map((record) => record.modelRequestId).sort()).toEqual(requests.map((request) => request.id).sort());
		for (const record of http) {
			expect(record.requestHeaders.authorization).toContain(REDACTED);
			expect(record.responseHeaders?.["set-cookie"]).toContain(REDACTED);
			expect(record.responseBody?.text).toContain("chat.completion.chunk");
			expect(record.network.remoteAddress).toBe("127.0.0.1");
		}
		expect(seenAuth).toContain(`Bearer ${API_KEY}`);

		const tool = records.find((record) => record.type === "tool_execution") as unknown as ToolExecutionRecord;
		expect(tool).toMatchObject({ toolName: "bash", toolCallId: "call_1", isError: false, cwd });
		expect(tool.args?.text).toContain("echo captured-output");
		expect(tool.content?.text).toContain("captured-output");
		expect(JSON.stringify(records)).not.toContain(API_KEY);

		// API
		const capture = new CaptureStore(captureDir);
		const store = new TraceStore({ roots: [sessionsDir] });
		const tracesServer = await startTracesServer({
			store,
			capture,
			uiDir: getTracesUiDir(),
			port: 0,
			pollIntervalMs: 0,
		});
		try {
			const get = async (path: string) => {
				const res = await fetch(`${tracesServer.baseUrl}${path}`, {
					headers: { Authorization: `Bearer ${tracesServer.token}` },
				});
				expect(res.status).toBe(200);
				return res.json() as Promise<Record<string, unknown>>;
			};
			const key = traceKeyForPath(sessionManager.getSessionFile()!);
			const sessionCapture = (await get(`api/sessions/${key}/capture`)) as {
				modelRequests: Array<{ id: string; messageTimestamp: number; http: number }>;
				tools: Array<{ toolCallId: string; fileKey: string; id: string }>;
			};
			expect(sessionCapture.modelRequests).toHaveLength(2);
			const detail = (await get(`api/sessions/${key}`)) as {
				events: Array<{ kind: string; messageTimestamp?: number }>;
			};
			const assistantTimestamps = detail.events
				.filter((event) => event.kind === "assistant")
				.map((event) => event.messageTimestamp);
			for (const request of sessionCapture.modelRequests)
				expect(assistantTimestamps).toContain(request.messageTimestamp);

			const second = (await get(`api/capture/model/${sessionCapture.modelRequests[1].id}`)) as {
				payload: { json: { messages: unknown[] } };
				http: Array<{ requestBody?: { sameAs?: string; text?: string }; network: { remoteAddress: string } }>;
				previous: { diff: { changed: Array<{ key: string; commonPrefix?: number; added?: unknown[] }> } };
				events: { total: number };
			};
			expect(second.payload.json.messages.length).toBeGreaterThan(2);
			expect(second.http[0].network.remoteAddress).toBe("127.0.0.1");
			expect(second.events.total).toBeGreaterThan(0);
			const messagesDiff = second.previous.diff.changed.find((entry) => entry.key === "messages");
			expect(messagesDiff?.added?.length).toBe(2);

			const toolDetail = (await get(
				`api/capture/tool/${sessionCapture.tools[0].fileKey}/${sessionCapture.tools[0].id}`,
			)) as { content: { text: string } };
			expect(toolDetail.content.text).toContain("captured-output");

			const network = (await get(`api/network?host=${encodeURIComponent(new URL(baseUrl).host)}`)) as {
				items: Array<{ sessionKey?: string; provider?: string; status: number }>;
			};
			expect(network.items).toHaveLength(2);
			expect(network.items.every((item) => item.sessionKey === key && item.provider === "capture-local")).toBe(true);
			expect(((await get("api/network?status=4xx")) as { items: unknown[] }).items).toHaveLength(0);
		} finally {
			await tracesServer.close();
		}
	});
});
