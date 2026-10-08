import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { type AssistantMessage, createAssistantMessageEventStream } from "@akramcode/ai";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureHttpDispatcher } from "../src/core/http-dispatcher.ts";
import type {
	HttpRecord,
	ModelRequestRecord,
	ToolExecutionRecord,
	WebSocketRecord,
} from "../src/core/traces/capture/format.ts";
import { DecompressionLimitError, decodeBody } from "../src/core/traces/capture/network.ts";
import {
	DEFAULT_TRACE_CAPTURE_SETTINGS,
	getTraceRecorder,
	installTraceRecorder,
	uninstallTraceRecorder,
} from "../src/core/traces/capture/recorder.ts";
import { capText } from "../src/core/traces/capture/writer.ts";
import { CaptureStore } from "../src/core/traces/capture-store.ts";
import { openWithoutTokenInArgs } from "../src/core/traces/cli.ts";
import { readLinesBounded } from "../src/core/traces/fs-safe.ts";
import { TraceStore, traceKeyForPath } from "../src/core/traces/store.ts";

const MB = 1024 * 1024;

let server: Server;
const upgraded = new Set<{ destroy(): void }>();
let baseUrl: string;

beforeAll(async () => {
	configureHttpDispatcher();
	server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			if (req.url === "/bomb") {
				// 20 MB of zeros, about 20 KB on the wire.
				res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
				res.end(gzipSync(Buffer.alloc(20 * MB)));
			} else if (req.url === "/big") {
				res.writeHead(200, { "content-type": "text/plain" });
				res.end("a".repeat(3 * MB));
			} else {
				res.writeHead(200, { "content-type": "text/plain" });
				res.end("x".repeat(100_000));
			}
		});
	});
	// Accept a WebSocket upgrade and ignore the frames.
	server.on("upgrade", (req, socket) => {
		upgraded.add(socket);
		const accept = createHash("sha1")
			.update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
			.digest("base64");
		socket.write(
			`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
		);
		socket.on("data", () => {});
		socket.on("error", () => {});
	});
	await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	for (const socket of upgraded) socket.destroy();
	server.closeAllConnections();
	await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
});

function records(dir: string): Array<Record<string, unknown> & { type: string }> {
	const out: Array<Record<string, unknown> & { type: string }> = [];
	const walk = (path: string) => {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			const full = join(path, entry.name);
			if (entry.isDirectory() && !entry.name.endsWith(".blobs")) walk(full);
			else if (entry.name.endsWith(".jsonl")) {
				for (const line of readFileSync(full, "utf8").split("\n")) if (line.trim()) out.push(JSON.parse(line));
			}
		}
	};
	walk(dir);
	return out;
}

describe("capture limits", () => {
	let root: string;
	let dir: string;

	function install(options: { maxBodyMb?: number; inFlightBudgetBytes?: number } = {}) {
		installTraceRecorder({
			agentDir: root,
			dir,
			settings: { ...DEFAULT_TRACE_CAPTURE_SETTINGS, maxBodyMb: options.maxBodyMb ?? 1 },
			inFlightBudgetBytes: options.inFlightBudgetBytes,
		});
	}

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "akramcode-traces-sec-"));
		dir = join(root, "traces");
	});

	afterEach(() => {
		uninstallTraceRecorder();
		rmSync(root, { recursive: true, force: true });
	});

	it("caps decompression so a compressed bomb is not expanded", async () => {
		install({ maxBodyMb: 1 });
		const res = await fetch(`${baseUrl}/bomb`);
		await res.arrayBuffer();
		const http = records(dir).find((record) => record.type === "http") as unknown as HttpRecord;
		expect(http.responseBody).toMatchObject({ truncated: true, contentEncoding: "gzip", binary: true });
		expect(http.responseBody?.note).toContain("exceeds the capture limit");
		expect(http.responseBody?.text).toBeUndefined();

		expect(() => decodeBody(gzipSync(Buffer.alloc(5 * MB)), "gzip", MB)).toThrow(DecompressionLimitError);
		expect(() => decodeBody(brotliCompressSync(Buffer.alloc(5 * MB)), "br", MB)).toThrow(DecompressionLimitError);
		expect(decodeBody(gzipSync(Buffer.from("small")), "gzip", MB).toString()).toBe("small");
	});

	it("caps a large response body at the limit, checking before buffering", async () => {
		install({ maxBodyMb: 1 });
		const res = await fetch(`${baseUrl}/big`);
		expect((await res.text()).length).toBe(3 * MB);
		const http = records(dir).find((record) => record.type === "http") as unknown as HttpRecord;
		expect(http.bytesIn).toBe(3 * MB);
		expect(http.responseBody?.truncated).toBe(true);
		expect(http.responseBody?.bytes).toBeLessThanOrEqual(MB);
		expect(getTraceRecorder()?.budget.used).toBe(0);
	});

	it("keeps metadata only once the shared in-flight budget is used up, and releases it", async () => {
		install({ maxBodyMb: 1, inFlightBudgetBytes: 1000 });
		await Promise.all([1, 2, 3].map(async () => (await fetch(`${baseUrl}/small`)).text()));
		const http = records(dir).filter((record) => record.type === "http") as unknown as HttpRecord[];
		expect(http).toHaveLength(3);
		for (const record of http) {
			expect(record.bytesIn).toBe(100_000);
			expect(record.responseBody?.note).toBe("in-flight capture memory budget exceeded");
			expect(record.responseBody?.bytes).toBeLessThanOrEqual(1000);
		}
		expect(getTraceRecorder()?.budget.used).toBe(0);
	});

	it("caps WebSocket frames before serializing them", async () => {
		install({ maxBodyMb: 1 });
		const recorder = getTraceRecorder()!;
		const socket = await recorder.runInContext({ sessionId: "s", modelRequestId: "m-big" }, async () => {
			const ws = new WebSocket(`${baseUrl.replace("http:", "ws:")}/socket`);
			await new Promise((resolveOpen) => ws.addEventListener("open", resolveOpen));
			ws.send("y".repeat(2 * MB));
			ws.send("small frame");
			return ws;
		});
		recorder.flushModelRequest("m-big");
		socket.close();
		const ws = records(dir).find((record) => record.type === "websocket") as unknown as WebSocketRecord;
		expect(ws.framesSent).toBe(2);
		expect(ws.bytesOut).toBe(2 * MB + 11);
		expect(ws.sent?.truncated).toBe(true);
		expect(ws.sent?.bytes).toBeLessThan(MB);
		expect(recorder.budget.used).toBe(0);
	});

	it("caps payloads and stream events of model requests", async () => {
		install({ maxBodyMb: 1 });
		const recorder = getTraceRecorder()!;
		const tracer = recorder.createSessionTracer({
			getSessionId: () => "cap-session",
			getSessionFile: () => undefined,
			cwd: root,
		});
		const model = { provider: "p", api: "a", id: "m" };
		const stream = tracer.traceStream(model, {}, (options) => {
			const out = createAssistantMessageEventStream();
			void (async () => {
				await options.onPayload?.({ messages: ["z".repeat(3 * MB)] }, model as never);
				await options.onProviderStreamEvent?.({ big: "e".repeat(2 * MB) }, model as never);
				await options.onProviderStreamEvent?.({ small: true }, model as never);
				out.end({
					role: "assistant",
					content: [{ type: "text", text: "ok" }],
					api: "a",
					provider: "p",
					model: "m",
					usage: {
						input: 1,
						output: 1,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 2,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: Date.now(),
				} as AssistantMessage);
			})();
			return out;
		});
		await stream.result();
		await new Promise((resolveTick) => setImmediate(resolveTick));
		const request = records(dir).find((record) => record.type === "model_request") as unknown as ModelRequestRecord;
		expect(request.payload?.truncated).toBe(true);
		expect(request.payload?.bytes).toBeLessThanOrEqual(MB);
		expect(request.eventCount).toBe(2);
		expect(request.events?.truncated).toBe(true);
		expect(recorder.budget.used).toBe(0);
	});

	it("copies full tool output only from regular files in the temp directory, capped", async () => {
		install({ maxBodyMb: 1 });
		const recorder = getTraceRecorder()!;
		const tracer = recorder.createSessionTracer({
			getSessionId: () => "tool-session",
			getSessionFile: () => undefined,
			cwd: root,
		});
		const big = join(root, "full-output.log");
		writeFileSync(big, `${"o".repeat(2 * MB)}`);
		const outside = join(process.cwd(), "package.json");
		const linked = join(root, "link-to-outside.log");
		symlinkSync(outside, linked);
		const run = (toolCallId: string, fullOutputPath: string) => {
			tracer.onAgentEvent({ type: "tool_execution_start", toolCallId, toolName: "bash", args: { command: "x" } });
			tracer.onAgentEvent({
				type: "tool_execution_end",
				toolCallId,
				toolName: "bash",
				isError: false,
				result: { content: [{ type: "text", text: "cut" }], details: { fullOutputPath } },
			});
		};
		run("in-temp", big);
		run("outside", outside);
		run("symlink", linked);
		const tools = records(dir).filter(
			(record) => record.type === "tool_execution",
		) as unknown as ToolExecutionRecord[];
		const byId = new Map(tools.map((tool) => [tool.toolCallId, tool]));
		expect(byId.get("in-temp")?.fullOutput?.truncated).toBe(true);
		expect(byId.get("in-temp")?.fullOutput?.bytes).toBeLessThanOrEqual(MB);
		expect(byId.get("outside")?.fullOutput).toBeUndefined();
		expect(byId.get("symlink")?.fullOutput).toBeUndefined();
	});

	it("writes trace directories as 0700 and files and blobs as 0600", async () => {
		install({ maxBodyMb: 1 });
		await (await fetch(`${baseUrl}/small`)).text();
		const processDir = join(dir, "process");
		const file = readdirSync(processDir).find((name) => name.endsWith(".jsonl"))!;
		const blobDir = join(processDir, file.replace(/\.jsonl$/, ".blobs"));
		const blob = readdirSync(blobDir)[0];
		expect(statSync(dir).mode & 0o777).toBe(0o700);
		expect(statSync(processDir).mode & 0o777).toBe(0o700);
		expect(statSync(join(processDir, file)).mode & 0o777).toBe(0o600);
		expect(statSync(blobDir).mode & 0o777).toBe(0o700);
		expect(statSync(join(blobDir, blob)).mode & 0o777).toBe(0o600);
	});
});

describe("capture text limits", () => {
	it("cuts text at a byte limit and drops a token-like tail at the cut", () => {
		expect(capText("short", 100)).toEqual({ text: "short", truncated: false });
		const cut = capText(`prefix sk-${"a".repeat(40)}`, 20);
		expect(cut.truncated).toBe(true);
		expect(cut.text).toBe("prefix ");
		expect(Buffer.byteLength(capText("é".repeat(100), 51).text)).toBeLessThanOrEqual(51);
	});

	it("cuts long base64 bodies in linear time and keeps most of them", () => {
		// A /[...]{8,}$/ regex took quadratic time on this input.
		const base64 = "QUJD".repeat(4 * 1024 * 1024);
		const started = performance.now();
		const cut = capText(`${base64} `, 8 * 1024 * 1024);
		expect(performance.now() - started).toBeLessThan(2000);
		expect(cut.truncated).toBe(true);
		expect(cut.text.length).toBe(8 * 1024 * 1024 - 4096);
	});

	it("skips lines longer than the limit without buffering them", async () => {
		const dir = mkdtempSync(join(tmpdir(), "akramcode-lines-"));
		try {
			const file = join(dir, "x.jsonl");
			writeFileSync(file, `first\n${"b".repeat(5000)}\nthird\n${"c".repeat(5000)}`);
			const lines: Array<string | null> = [];
			for await (const line of readLinesBounded(file, 1000)) lines.push(line);
			expect(lines).toEqual(["first", null, "third", null]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("traces file containment", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "akramcode-contain-"));
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("does not index session files reached through links that leave the session root", async () => {
		const sessions = join(root, "sessions");
		const outside = join(root, "outside");
		mkdirSync(join(sessions, "--project--"), { recursive: true });
		mkdirSync(outside);
		const header = `${JSON.stringify({ type: "session", version: 3, id: "s", timestamp: new Date().toISOString(), cwd: "/p" })}\n`;
		writeFileSync(join(sessions, "--project--", "inside.jsonl"), header);
		writeFileSync(join(outside, "secret.jsonl"), header);
		symlinkSync(outside, join(sessions, "--linked--"));
		symlinkSync(join(outside, "secret.jsonl"), join(sessions, "--project--", "linked.jsonl"));
		const store = new TraceStore({ roots: [sessions] });
		await store.refresh();
		expect(store.getSummaries().map((summary) => summary.path)).toEqual([
			join(sessions, "--project--", "inside.jsonl"),
		]);
		expect(
			await store.resolveServablePath(traceKeyForPath(join(sessions, "--project--", "inside.jsonl"))),
		).toBeDefined();
	});

	it("serves blobs only from the trace file's own blob directory", async () => {
		const tracesDir = join(root, "traces");
		const sessionDir = join(tracesDir, "sessions", "s1");
		mkdirSync(join(sessionDir, "f.blobs"), { recursive: true });
		writeFileSync(
			join(sessionDir, "f.jsonl"),
			`${JSON.stringify({ type: "trace_header", version: 1, t: 1, pid: 1, scope: "session", sessionId: "s1" })}\n`,
		);
		writeFileSync(join(sessionDir, "f.blobs", "ok.txt"), "blob text");
		writeFileSync(join(root, "secret.txt"), "secret");
		symlinkSync(join(root, "secret.txt"), join(sessionDir, "f.blobs", "evil.txt"));
		// A linked trace file outside the directory is not indexed either.
		writeFileSync(join(root, "other.jsonl"), "{}\n");
		symlinkSync(join(root, "other.jsonl"), join(sessionDir, "linked.jsonl"));
		const capture = new CaptureStore(tracesDir);
		await capture.refresh();
		const key = traceKeyForPath(join(sessionDir, "f.jsonl"));
		expect(capture.getFile(traceKeyForPath(join(sessionDir, "linked.jsonl")))).toBeUndefined();
		expect((await capture.readBlobPrefix(key, "ok.txt"))?.text).toBe("blob text");
		for (const name of ["..", ".", "../f.jsonl", "evil.txt", ".hidden", "missing.txt"]) {
			expect(await capture.resolveBlobPath(key, name)).toBeUndefined();
		}
	});
});

describe("--open", () => {
	it("opens a private local page instead of passing the token on the command line", () => {
		let opened = "";
		const url = `http://127.0.0.1:1234/#token=${"a".repeat(64)}`;
		const launcher = openWithoutTokenInArgs(url, (target) => {
			opened = target;
		});
		try {
			expect(opened).toBe(launcher.file);
			expect(opened).not.toContain("token");
			expect(statSync(opened).mode & 0o777).toBe(0o600);
			expect(readFileSync(opened, "utf8")).toContain(`url=${url}`);
		} finally {
			launcher.cleanup();
		}
		expect(existsSync(launcher.file)).toBe(false);
	});
});
