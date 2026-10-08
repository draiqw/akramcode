import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTracesUiDir } from "../src/config.ts";
import {
	aggregateSummaries,
	analyzeEntries,
	filterSummaries,
	normalizeErrorMessage,
	parseTraceFilter,
} from "../src/core/traces/analyze.ts";
import { parseTracesArgs, runTracesCommand } from "../src/core/traces/cli.ts";
import { startTracesServer, type TracesServer } from "../src/core/traces/server.ts";
import { TraceStore, traceKeyForPath } from "../src/core/traces/store.ts";

const T0 = Date.parse("2026-10-01T10:00:00.000Z");

function iso(offsetMs: number): string {
	return new Date(T0 + offsetMs).toISOString();
}

function usage(input: number, output: number, cost = 0) {
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}

function header(id: string, cwd: string, extra: Record<string, unknown> = {}) {
	return { type: "session", version: 3, id, timestamp: iso(0), cwd, ...extra };
}

function msg(id: string, parentId: string | null, offset: number, message: Record<string, unknown>) {
	return { type: "message", id, parentId, timestamp: iso(offset), message };
}

function assistant(
	id: string,
	parentId: string,
	start: number,
	end: number,
	content: unknown[],
	stopReason: string,
	extra: Record<string, unknown> = {},
) {
	return msg(id, parentId, end, {
		role: "assistant",
		content,
		api: "faux",
		provider: "faux",
		model: "faux-1",
		usage: usage(100, 20, 0.01),
		stopReason,
		timestamp: T0 + start,
		...extra,
	});
}

function toolResult(
	id: string,
	parentId: string,
	at: number,
	callId: string,
	toolName: string,
	text: string,
	isError: boolean,
	details?: unknown,
) {
	return msg(id, parentId, at, {
		role: "toolResult",
		toolCallId: callId,
		toolName,
		content: [{ type: "text", text }],
		isError,
		timestamp: T0 + at,
		...(details ? { details } : {}),
	});
}

function writeJsonl(path: string, lines: unknown[], trailing = ""): void {
	writeFileSync(
		path,
		`${lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n")}\n${trailing}`,
	);
}

interface Fixture {
	root: string;
	agentDir: string;
	sessionsDir: string;
	mainPath: string;
	childPath: string;
	otherPath: string;
}

/** A main session with tool errors, a retry, a branch and a subagent, plus a second aborted session. */
function createFixture(): Fixture {
	const root = mkdtempSync(join(tmpdir(), "akramcode-traces-test-"));
	const agentDir = join(root, "agent");
	const sessionsDir = join(agentDir, "sessions");
	const projectDir = join(sessionsDir, "--work-alpha--");
	const otherDir = join(sessionsDir, "--work-beta--");
	mkdirSync(projectDir, { recursive: true });
	mkdirSync(otherDir, { recursive: true });

	const mainBase = "2026-10-01T10-00-00-000Z_main-session";
	const mainPath = join(projectDir, `${mainBase}.jsonl`);
	const childDir = join(projectDir, `${mainBase}.subagents`);
	mkdirSync(childDir);
	const childPath = join(childDir, "2026-10-01T10-00-05-000Z_child-session.jsonl");

	writeJsonl(
		mainPath,
		[
			header("main-session", "/work/alpha"),
			{ type: "model_change", id: "m0", parentId: null, timestamp: iso(1), provider: "faux", modelId: "faux-1" },
			msg("u1", "m0", 10, {
				role: "user",
				content: [{ type: "text", text: "Fix the failing build please" }],
				timestamp: T0 + 10,
			}),
			assistant(
				"a1",
				"u1",
				20,
				1020,
				[
					{ type: "thinking", thinking: "Let me look" },
					{ type: "toolCall", id: "c1", name: "read", arguments: { path: "/work/alpha/src/a.ts" } },
					{ type: "toolCall", id: "c2", name: "edit", arguments: { path: "/work/alpha/src/a.ts" } },
				],
				"toolUse",
			),
			toolResult("r1", "a1", 1100, "c1", "read", "export const a = 1;", false),
			toolResult(
				"r2",
				"r1",
				1520,
				"c2",
				"edit",
				"Could not find the exact text in /work/alpha/src/a.ts at line 12",
				true,
			),
			assistant("a2", "r2", 1600, 1700, [{ type: "toolCall", id: "c3", name: "edit", arguments: {} }], "toolUse"),
			toolResult(
				"r3",
				"a2",
				1800,
				"c3",
				"edit",
				"Could not find the exact text in /work/alpha/src/b.ts at line 99",
				true,
			),
			assistant("a3", "r3", 1900, 2000, [], "error", { errorMessage: "529 overloaded_error: Overloaded" }),
			{ type: "context_edit", id: "ce1", parentId: "a3", timestamp: iso(2001), targetId: "a3", replacement: null },
			assistant(
				"a4",
				"ce1",
				3000,
				3500,
				[{ type: "toolCall", id: "c4", name: "agent", arguments: { description: "Find needle", prompt: "find" } }],
				"toolUse",
			),
			toolResult("r4", "a4", 9000, "c4", "agent", "found it", false, {
				agentType: "explore",
				// Recorded through a different path spelling, as macOS does with /var vs /private/var.
				transcriptFile: `/elsewhere/${"2026-10-01T10-00-05-000Z_child-session.jsonl"}`,
			}),
			"{this line is not json",
			assistant("a5", "r4", 9100, 9600, [{ type: "text", text: "Done, the build passes." }], "stop"),
			{
				type: "compaction",
				id: "k1",
				parentId: "a5",
				timestamp: iso(9700),
				summary: "Summary of work",
				firstKeptEntryId: "a5",
				tokensBefore: 5000,
				usage: usage(50, 10, 0.001),
			},
			// A second branch from u1: makes u1 a branch point and the first branch off-path... no: the
			// last entry decides the active path, so this branch is the active one.
			msg("u2", "k1", 9800, { role: "user", content: "Thanks", timestamp: T0 + 9800 }),
			assistant("a6", "u2", 9900, 10000, [{ type: "text", text: "You're welcome." }], "stop"),
			msg("u3", "u1", 10100, { role: "user", content: "Alternative approach", timestamp: T0 + 10100 }),
			assistant("a7", "u3", 10200, 10300, [{ type: "text", text: "Alt" }], "stop"),
		],
		'{"type":"message","id":"partial"',
	);

	writeJsonl(childPath, [
		header("child-session", "/work/alpha"),
		msg("cu1", null, 5000, { role: "user", content: "find", timestamp: T0 + 5000 }),
		assistant(
			"ca1",
			"cu1",
			5100,
			5200,
			[{ type: "toolCall", id: "cc1", name: "bash", arguments: { command: "rg needle" } }],
			"toolUse",
		),
		toolResult("cr1", "ca1", 5300, "cc1", "bash", "needle.txt", false),
		assistant("ca2", "cr1", 5400, 5500, [{ type: "text", text: "found it" }], "stop"),
	]);

	const otherPath = join(otherDir, "2026-09-30T08-00-00-000Z_other-session.jsonl");
	writeJsonl(otherPath, [
		{ ...header("other-session", "/work/beta"), timestamp: "2026-09-30T08:00:00.000Z" },
		msg("o1", null, -86_400_000, { role: "user", content: "Run the tests", timestamp: T0 - 86_400_000 }),
		{
			...assistant(
				"o2",
				"o1",
				-86_399_000,
				-86_398_000,
				[{ type: "toolCall", id: "oc1", name: "bash", arguments: { command: "npm test" } }],
				"toolUse",
			),
			message: {
				role: "assistant",
				content: [{ type: "toolCall", id: "oc1", name: "bash", arguments: { command: "npm test" } }],
				provider: "other",
				model: "big-2",
				usage: usage(10, 5),
				stopReason: "toolUse",
				timestamp: T0 - 86_399_000,
			},
		},
		msg("o3", "o2", -86_390_000, {
			role: "assistant",
			content: [],
			provider: "other",
			model: "big-2",
			usage: usage(0, 0),
			stopReason: "aborted",
			timestamp: T0 - 86_391_000,
		}),
	]);

	// Not a session: no header. Must be ignored.
	writeFileSync(join(otherDir, "notes.jsonl"), '{"hello":"world"}\n');
	return { root, agentDir, sessionsDir, mainPath, childPath, otherPath };
}

let currentToken = "";

/** fetch with the traces server token. */
function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
	return fetch(url, {
		...init,
		headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${currentToken}` },
	});
}

function httpGet(
	url: string,
	options: { host?: string; method?: string; auth?: string; cookie?: string } = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
	return new Promise((resolveRequest, rejectRequest) => {
		const target = new URL(url);
		const req = request(
			{
				hostname: target.hostname,
				port: target.port,
				path: `${target.pathname}${target.search}`,
				method: options.method ?? "GET",
				headers: {
					...(options.host ? { Host: options.host } : {}),
					...(options.auth ? { Authorization: options.auth } : {}),
					...(options.cookie ? { Cookie: options.cookie } : {}),
				},
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					body += chunk;
				});
				res.on("end", () => resolveRequest({ status: res.statusCode ?? 0, headers: res.headers, body }));
			},
		);
		req.on("error", rejectRequest);
		req.end();
	});
}

describe("traces analysis", () => {
	it("normalizes variable parts of error messages", () => {
		expect(normalizeErrorMessage("Could not find the exact text in /work/alpha/src/a.ts at line 12")).toBe(
			normalizeErrorMessage("Could not find the exact text in /tmp/x/b.ts at line 99"),
		);
		expect(normalizeErrorMessage('File "foo" not found\nstack...')).toBe('File "…" not found');
		expect(normalizeErrorMessage("id 01a11c32-38d9-75f7-b533-dfdd32e798fb failed")).toBe("id <id> failed");
	});

	it("summarizes tools, errors, retries, branches, and usage", () => {
		const entries = [
			header("s", "/p"),
			msg("u1", null, 0, { role: "user", content: "hi", timestamp: T0 }),
			assistant(
				"a1",
				"u1",
				10,
				510,
				[{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } }],
				"toolUse",
			),
			toolResult("r1", "a1", 800, "c1", "bash", "boom", true),
			assistant("a2", "r1", 900, 950, [], "error", { errorMessage: "overloaded" }),
			{ type: "context_edit", id: "e1", parentId: "a2", timestamp: iso(960), targetId: "a2", replacement: null },
			assistant("a3", "e1", 1000, 1100, [{ type: "toolCall", id: "c2", name: "bash", arguments: {} }], "toolUse"),
		];
		const result = analyzeEntries(entries, {
			key: "k",
			path: "/x.jsonl",
			sizeBytes: 1,
			mtimeMs: 1,
			malformedLines: 0,
			isSubagent: false,
		});
		expect(result).toBeDefined();
		const summary = result!.summary;
		expect(summary.userMessages).toBe(1);
		expect(summary.assistantMessages).toBe(3);
		expect(summary.toolCalls).toBe(2);
		expect(summary.toolErrors).toBe(1);
		expect(summary.assistantErrors).toBe(1);
		expect(summary.retries).toBe(1);
		expect(summary.orphanToolCalls).toBe(1);
		expect(summary.tools.bash).toMatchObject({ calls: 2, errors: 1, timed: 1, totalMs: 290 });
		expect(summary.latency.count).toBe(3);
		expect(summary.latency.maxMs).toBe(500);
		expect(summary.tokens.total).toBe(360);
		expect(summary.cost).toBeCloseTo(0.03);
		expect(summary.lastStopReason).toBe("toolUse");
		const omitted = result!.events.find((event) => event.id === "a2");
		expect(omitted?.omitted).toBe(true);
		const toolEvent = result!.events.find((event) => event.id === "r1");
		expect(toolEvent).toMatchObject({ kind: "toolResult", isError: true, durationMs: 290, text: "boom" });
	});

	it("returns undefined for files without a session header", () => {
		expect(
			analyzeEntries([{ hello: "world" }], {
				key: "k",
				path: "/x",
				sizeBytes: 0,
				mtimeMs: 0,
				malformedLines: 0,
				isSubagent: false,
			}),
		).toBeUndefined();
	});

	it("parses filter query parameters", () => {
		const filter = parseTraceFilter(
			new URLSearchParams("q=build&errors=1&from=2026-10-01&to=2026-10-01&subagents=exclude"),
		);
		expect(filter.q).toBe("build");
		expect(filter.errors).toBe(true);
		expect(filter.subagents).toBe("exclude");
		expect(filter.to! - filter.from!).toBe(24 * 60 * 60 * 1000);
	});
});

describe("TraceStore", () => {
	let fixture: Fixture;

	beforeEach(() => {
		fixture = createFixture();
	});

	afterEach(() => {
		rmSync(fixture.root, { recursive: true, force: true });
	});

	it("indexes sessions across projects, links subagents, and tolerates malformed lines", async () => {
		const store = new TraceStore({ roots: [fixture.sessionsDir] });
		expect(await store.refresh()).toBe(true);
		const summaries = store.getSummaries();
		expect(summaries.map((summary) => summary.sessionId).sort()).toEqual([
			"child-session",
			"main-session",
			"other-session",
		]);

		const main = store.getSummary(traceKeyForPath(fixture.mainPath))!;
		const child = store.getSummary(traceKeyForPath(fixture.childPath))!;
		expect(main.malformedLines).toBe(2);
		expect(main.childKeys).toEqual([child.key]);
		expect(child.isSubagent).toBe(true);
		expect(child.parentKey).toBe(main.key);
		expect(main.toolErrors).toBe(2);
		expect(main.retries).toBe(1);
		expect(main.compactions).toBe(1);
		expect(main.branchPoints).toBe(1);
		expect(main.offPathEntries).toBeGreaterThan(0);
		expect(main.subagentCalls).toBe(1);
		expect(main.firstMessage).toBe("Fix the failing build please");

		const detail = await store.getDetail(main.key);
		const agentResult = detail!.events.find((event) => event.toolCallId === "c4");
		expect(agentResult?.childKey).toBe(child.key);
		expect(detail!.events.find((event) => event.id === "a7")?.offPath).toBeFalsy();
		expect(detail!.events.find((event) => event.id === "a6")?.offPath).toBe(true);
		expect(detail!.events.find((event) => event.id === "u1")?.branchPoint).toBe(true);
	});

	it("re-reads only changed files and reports changes", async () => {
		const store = new TraceStore({ roots: [fixture.sessionsDir] });
		await store.refresh();
		const version = store.version;
		expect(await store.refresh()).toBe(false);
		expect(store.version).toBe(version);

		appendFileSync(
			fixture.otherPath,
			`${JSON.stringify(msg("o4", "o3", 0, { role: "user", content: "again", timestamp: T0 }))}\n`,
		);
		expect(await store.refresh()).toBe(true);
		expect(store.version).toBe(version + 1);
		expect(store.getSummary(traceKeyForPath(fixture.otherPath))?.userMessages).toBe(2);

		rmSync(fixture.otherPath);
		expect(await store.refresh()).toBe(true);
		expect(store.getSummaries()).toHaveLength(2);
	});

	it("aggregates failures across sessions", async () => {
		const store = new TraceStore({ roots: [fixture.sessionsDir] });
		await store.refresh();
		const aggregate = aggregateSummaries(store.getSummaries());
		expect(aggregate.sessions).toBe(3);
		expect(aggregate.subagentSessions).toBe(1);
		expect(aggregate.toolErrors).toBe(2);
		expect(aggregate.abortedSessions).toBe(1);
		expect(aggregate.orphanToolCalls).toBe(1);
		expect(aggregate.tools[0]).toMatchObject({ name: "edit", calls: 2, errors: 2, errorRate: 1 });
		const editGroup = aggregate.errorGroups.find((group) => group.tool === "edit");
		expect(editGroup).toMatchObject({ count: 2, sessions: 1, kind: "tool" });
		expect(aggregate.errorGroups.find((group) => group.kind === "assistant")?.signature).toContain(
			"overloaded_error",
		);
		expect(aggregate.struggling[0]?.key).toBe(traceKeyForPath(fixture.mainPath));
		expect(aggregate.models.map((model) => model.model).sort()).toEqual(["faux/faux-1", "other/big-2"]);

		const onlyErrors = filterSummaries(store.getSummaries(), { errors: true });
		expect(onlyErrors.map((summary) => summary.sessionId)).toEqual(["main-session"]);
		// Tool call arguments are searchable: the parent's agent call and the child's bash call both mention it.
		expect(
			filterSummaries(store.getSummaries(), { q: "needle" })
				.map((summary) => summary.sessionId)
				.sort(),
		).toEqual(["child-session", "main-session"]);
		expect(filterSummaries(store.getSummaries(), { q: "overloaded" }).map((summary) => summary.sessionId)).toEqual([
			"main-session",
		]);
		expect(filterSummaries(store.getSummaries(), { project: "/work/beta" })).toHaveLength(1);
		expect(filterSummaries(store.getSummaries(), { subagents: "exclude" })).toHaveLength(2);
		expect(filterSummaries(store.getSummaries(), { model: "big" })).toHaveLength(1);
	});
});

describe("traces HTTP server", () => {
	let fixture: Fixture;
	let server: TracesServer | undefined;

	beforeEach(() => {
		fixture = createFixture();
	});

	afterEach(async () => {
		await server?.close();
		server = undefined;
		rmSync(fixture.root, { recursive: true, force: true });
	});

	async function start(pollIntervalMs = 0): Promise<TracesServer> {
		const store = new TraceStore({ roots: [fixture.sessionsDir] });
		server = await startTracesServer({ store, uiDir: getTracesUiDir(), port: 0, pollIntervalMs });
		currentToken = server.token;
		return server;
	}

	it("serves the UI and the JSON API on 127.0.0.1", async () => {
		const { baseUrl: url, url: tokenUrl } = await start();
		expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
		expect(tokenUrl).toMatch(/\?token=[0-9a-f]{64}$/);

		const page = await authFetch(url);
		expect(page.status).toBe(200);
		expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
		expect(await page.text()).toContain("akramcode traces");
		expect((await authFetch(`${url}app.js`)).status).toBe(200);
		expect((await authFetch(`${url}app.css`)).status).toBe(200);

		const list = (await (await authFetch(`${url}api/sessions`)).json()) as {
			total: number;
			sessions: Array<{ key: string; sessionId: string; searchText?: string }>;
		};
		expect(list.total).toBe(3);
		expect(list.sessions[0]?.searchText).toBeUndefined();
		const errors = (await (await authFetch(`${url}api/sessions?errors=1`)).json()) as { total: number };
		expect(errors.total).toBe(1);

		const mainKey = traceKeyForPath(fixture.mainPath);
		const detail = (await (await authFetch(`${url}api/sessions/${mainKey}`)).json()) as {
			summary: { sessionId: string };
			events: Array<{ kind: string }>;
			children: Array<{ sessionId: string }>;
		};
		expect(detail.summary.sessionId).toBe("main-session");
		expect(detail.events.some((event) => event.kind === "compaction")).toBe(true);
		expect(detail.children.map((child) => child.sessionId)).toEqual(["child-session"]);

		const childDetail = (await (
			await authFetch(`${url}api/sessions/${traceKeyForPath(fixture.childPath)}`)
		).json()) as {
			parent: { sessionId: string };
		};
		expect(childDetail.parent.sessionId).toBe("main-session");

		const raw = await authFetch(`${url}api/sessions/${mainKey}/raw`);
		expect(raw.headers.get("content-disposition")).toContain("attachment");
		expect(await raw.text()).toContain("{this line is not json");

		const exported = (await (await authFetch(`${url}api/sessions/${mainKey}/export`)).json()) as {
			entries: unknown[];
		};
		expect((exported.entries[0] as { type: string }).type).toBe("session");

		const aggregate = (await (await authFetch(`${url}api/aggregate?subagents=exclude`)).json()) as {
			sessions: number;
			tools: Array<{ name: string }>;
		};
		expect(aggregate.sessions).toBe(2);
		expect(aggregate.tools[0]?.name).toBe("edit");

		const bulk = (await (
			await authFetch(`${url}api/export?project=${encodeURIComponent("/work/alpha")}`)
		).json()) as {
			sessions: Array<{ summary: { sessionId: string }; entries: unknown[] }>;
		};
		expect(bulk.sessions.map((session) => session.summary.sessionId).sort()).toEqual([
			"child-session",
			"main-session",
		]);

		const facets = (await (await authFetch(`${url}api/facets`)).json()) as { projects: Array<{ value: string }> };
		expect(facets.projects.map((project) => project.value).sort()).toEqual(["/work/alpha", "/work/beta"]);

		expect((await authFetch(`${url}api/sessions/0123456789abcdef`)).status).toBe(404);
		expect((await authFetch(`${url}api/nope`)).status).toBe(404);
		expect((await authFetch(`${url}../etc/passwd`)).status).toBe(404);
	});

	it("rejects foreign Host headers and write methods", async () => {
		const { baseUrl: url, port } = await start();
		const auth = `Bearer ${currentToken}`;
		expect((await httpGet(`${url}api/sessions`, { host: `evil.example:${port}`, auth })).status).toBe(403);
		expect((await httpGet(`${url}api/sessions`, { host: `localhost:${port}`, auth })).status).toBe(200);
		expect((await httpGet(`${url}api/sessions`, { method: "POST", auth })).status).toBe(405);
	});

	it("requires the per-run token for every request", async () => {
		const { baseUrl, url: tokenUrl, token } = await start();
		for (const path of ["", "app.js", "app.css", "api/sessions", "api/events", "api/network"]) {
			expect((await httpGet(`${baseUrl}${path}`)).status).toBe(401);
			expect((await httpGet(`${baseUrl}${path}`, { auth: "Bearer wrong" })).status).toBe(401);
			expect((await httpGet(`${baseUrl}${path}`, { cookie: "akramcode_traces=wrong" })).status).toBe(401);
		}
		expect((await httpGet(`${baseUrl}?token=${"0".repeat(64)}`)).status).toBe(401);
		expect((await httpGet(`${baseUrl}?token=short`)).status).toBe(401);

		// The tokenized URL sets an HttpOnly cookie and redirects to strip the token.
		const first = await httpGet(tokenUrl);
		expect(first.status).toBe(302);
		expect(first.headers.location).toBe("/");
		const setCookie = String(first.headers["set-cookie"]);
		expect(setCookie).toContain(`akramcode_traces=${token}`);
		expect(setCookie).toContain("HttpOnly");
		expect(setCookie).toContain("SameSite=Strict");
		const cookie = `akramcode_traces=${token}`;
		expect((await httpGet(baseUrl, { cookie })).status).toBe(200);
		expect((await httpGet(`${baseUrl}api/sessions`, { cookie })).status).toBe(200);
		expect((await httpGet(`${baseUrl}api/sessions?token=${token}`)).status).toBe(200);
		expect((await httpGet(`${baseUrl}api/sessions`, { auth: `Bearer ${token}` })).status).toBe(200);
	});

	it("pushes a version event when a new session appears", async () => {
		const { baseUrl: url } = await start(100);
		await authFetch(`${url}api/version`);
		const events = await new Promise<string>((resolveEvents, rejectEvents) => {
			const req = request(`${url}api/events`, { headers: { Authorization: `Bearer ${currentToken}` } }, (res) => {
				let buffer = "";
				let sawInitial = false;
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					buffer += chunk;
					if (!sawInitial && buffer.includes("event: version")) {
						sawInitial = true;
						const dir = join(fixture.sessionsDir, "--work-gamma--");
						mkdirSync(dir);
						writeJsonl(join(dir, "2026-10-02T00-00-00-000Z_new.jsonl"), [header("new-session", "/work/gamma")]);
					}
					if (buffer.includes('"sessions":4')) {
						req.destroy();
						resolveEvents(buffer);
					}
				});
			});
			req.on("error", (error) => {
				if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") rejectEvents(error);
			});
			req.end();
		});
		expect(events).toContain('"sessions":4');
		const list = (await (
			await authFetch(`${url}api/sessions?project=${encodeURIComponent("/work/gamma")}`)
		).json()) as {
			total: number;
		};
		expect(list.total).toBe(1);
	});
});

describe("akramcode traces command", () => {
	it("parses options", () => {
		expect(parseTracesArgs(["--port", "8080", "--open", "--session-dir", "/tmp/x", "--poll", "0"])).toMatchObject({
			port: 8080,
			open: true,
			sessionDirs: ["/tmp/x"],
			pollIntervalMs: 0,
		});
		expect(parseTracesArgs(["--port", "nope"])).toBe("Invalid --port: nope");
		expect(parseTracesArgs(["--bogus"])).toBe("Unknown option: --bogus");
		expect(parseTracesArgs(["--port"])).toBe("--port requires a value");
	});

	it("serves sessions from the agent dir and extra session dirs until stopped", async () => {
		const fixture = createFixture();
		const extraDir = join(fixture.root, "custom-sessions");
		mkdirSync(extraDir);
		writeJsonl(join(extraDir, "2026-10-03T00-00-00-000Z_custom.jsonl"), [header("custom-session", "/work/custom")]);
		let stop: () => void = () => {};
		const stopped = new Promise<void>((resolveStop) => {
			stop = resolveStop;
		});
		let total = -1;
		const log = console.log;
		console.log = () => {};
		try {
			const exitCode = await runTracesCommand(["--port", "0", "--poll", "0"], {
				agentDir: fixture.agentDir,
				settingsSessionDir: extraDir,
				waitForStop: () => stopped,
				onListening: ({ baseUrl, token }) => {
					void fetch(`${baseUrl}api/sessions`, { headers: { Authorization: `Bearer ${token}` } })
						.then((res) => res.json() as Promise<{ total: number }>)
						.then((body) => {
							total = body.total;
						})
						.finally(stop);
				},
			});
			expect(exitCode).toBe(0);
			expect(total).toBe(4);
		} finally {
			console.log = log;
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});
});
