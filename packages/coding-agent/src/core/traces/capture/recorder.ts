/**
 * Process-wide trace capture: what each session sends to the model and receives back, every HTTP
 * request and WebSocket exchange of the process, and every tool execution. `main()` installs the
 * recorder; sessions created afterwards attach a {@link SessionTracer}. Without an installed
 * recorder (SDK use, tests) nothing is captured.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type { AgentEvent } from "@akramcode/agent-core";
import type { AssistantMessageEventStream, ModelsSimpleStreamOptions } from "@akramcode/ai";
import {
	type BodyRef,
	CAPTURE_DIR_NAME,
	CAPTURE_FORMAT_VERSION,
	type ModelRequestRecord,
	type ToolExecutionRecord,
} from "./format.ts";
import { NetworkCapture, type NetworkSink, type TraceContext } from "./network.ts";
import { Redactor } from "./redact.ts";
import { CaptureFile, capText, enforceCaptureRetention, MemoryBudget, sha1 } from "./writer.ts";

export interface TraceCaptureSettings {
	enabled: boolean;
	maxTotalSizeMb: number;
	maxAgeDays: number;
	maxBodyMb: number;
}

export const DEFAULT_TRACE_CAPTURE_SETTINGS: TraceCaptureSettings = {
	enabled: true,
	maxTotalSizeMb: 2048,
	maxAgeDays: 30,
	maxBodyMb: 32,
};

function positive(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Resolve the `traces` setting. `AKRAMCODE_TRACES=0` (or `false`/`no`) turns capture off and
 * `AKRAMCODE_TRACES=1` turns it on, overriding the setting.
 */
export function resolveTraceCaptureSettings(
	input: Partial<TraceCaptureSettings> | undefined,
	env: string | undefined = process.env.AKRAMCODE_TRACES,
): TraceCaptureSettings {
	const defaults = DEFAULT_TRACE_CAPTURE_SETTINGS;
	let enabled = typeof input?.enabled === "boolean" ? input.enabled : defaults.enabled;
	if (env !== undefined && env !== "") enabled = !/^(?:0|false|no|off)$/i.test(env.trim());
	return {
		enabled,
		maxTotalSizeMb: positive(input?.maxTotalSizeMb, defaults.maxTotalSizeMb),
		maxAgeDays: positive(input?.maxAgeDays, defaults.maxAgeDays),
		maxBodyMb: positive(input?.maxBodyMb, defaults.maxBodyMb),
	};
}

const RETENTION_INTERVAL_MS = 30 * 60 * 1000;
const RETENTION_START_DELAY_MS = 10_000;
const RECENT_PAYLOADS_KEPT = 200;
/** Bytes buffered across all in-flight captures before captures fall back to metadata only. */
export const DEFAULT_IN_FLIGHT_BUDGET_BYTES = 256 * 1024 * 1024;

export interface TraceRecorderOptions {
	agentDir: string;
	settings: TraceCaptureSettings;
	appVersion?: string;
	/** Override the capture directory (tests). Default: `<agentDir>/traces`. */
	dir?: string;
	/** Override the in-flight memory budget (tests). */
	inFlightBudgetBytes?: number;
}

function fileTimestamp(time: number): string {
	return new Date(time).toISOString().replace(/[:.]/g, "-");
}

function safeName(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return String(value);
	}
}

let installed: TraceRecorder | undefined;

/** The recorder installed for this process, if trace capture is on. */
export function getTraceRecorder(): TraceRecorder | undefined {
	return installed;
}

/** Install process-wide capture. Returns undefined when disabled. Idempotent. */
export function installTraceRecorder(options: TraceRecorderOptions): TraceRecorder | undefined {
	if (!options.settings.enabled) return undefined;
	if (installed) return installed;
	installed = new TraceRecorder(options);
	installed.start();
	return installed;
}

/** Stop capture (tests). */
export function uninstallTraceRecorder(): void {
	installed?.stop();
	installed = undefined;
}

export class TraceRecorder implements NetworkSink {
	readonly dir: string;
	readonly redactor = new Redactor();
	readonly maxBodyBytes: number;
	readonly budget: MemoryBudget;
	private readonly settings: TraceCaptureSettings;
	private readonly appVersion: string | undefined;
	private readonly storage = new AsyncLocalStorage<TraceContext>();
	private readonly startedAt = Date.now();
	private readonly sessionFiles = new Map<string, CaptureFile>();
	private readonly sessionMeta = new Map<string, { sessionFile?: string; cwd?: string }>();
	private processFile: CaptureFile | undefined;
	private readonly recentPayloads = new Map<string, string>();
	private readonly network: NetworkCapture;
	private retentionTimer: NodeJS.Timeout | undefined;
	private counter = 0;
	private readonly idPrefix = randomBytes(3).toString("hex");
	private readonly onExit = () => this.network.flushWebSockets();

	constructor(options: TraceRecorderOptions) {
		this.dir = options.dir ?? join(options.agentDir, CAPTURE_DIR_NAME);
		this.settings = options.settings;
		this.appVersion = options.appVersion;
		this.maxBodyBytes = Math.max(1, options.settings.maxBodyMb) * 1024 * 1024;
		this.budget = new MemoryBudget(options.inFlightBudgetBytes ?? DEFAULT_IN_FLIGHT_BUDGET_BYTES);
		this.network = new NetworkCapture(this);
	}

	start(): void {
		this.network.install();
		process.once("exit", this.onExit);
		const runRetention = () => {
			void this.enforceRetention();
		};
		const first = setTimeout(runRetention, RETENTION_START_DELAY_MS);
		first.unref();
		this.retentionTimer = setInterval(runRetention, RETENTION_INTERVAL_MS);
		this.retentionTimer.unref();
	}

	stop(): void {
		this.network.uninstall();
		process.off("exit", this.onExit);
		if (this.retentionTimer) clearInterval(this.retentionTimer);
	}

	enforceRetention(now?: number): Promise<number> {
		const protect = new Set<string>([...this.sessionFiles.values()].map((file) => file.path));
		if (this.processFile) protect.add(this.processFile.path);
		return enforceCaptureRetention(this.dir, {
			maxTotalBytes: this.settings.maxTotalSizeMb * 1024 * 1024,
			maxAgeMs: this.settings.maxAgeDays * 24 * 60 * 60 * 1000,
			protect,
			now,
		}).catch(() => 0);
	}

	newId(prefix: string): string {
		this.counter++;
		return `${prefix}-${this.idPrefix}-${this.counter.toString(36)}`;
	}

	context(): TraceContext | undefined {
		return this.storage.getStore();
	}

	runInContext<T>(context: TraceContext, fn: () => T): T {
		return this.storage.run(context, fn);
	}

	payloadSha1(modelRequestId: string): string | undefined {
		return this.recentPayloads.get(modelRequestId);
	}

	rememberPayload(modelRequestId: string, hash: string): void {
		this.recentPayloads.set(modelRequestId, hash);
		if (this.recentPayloads.size > RECENT_PAYLOADS_KEPT) {
			const oldest = this.recentPayloads.keys().next().value;
			if (oldest !== undefined) this.recentPayloads.delete(oldest);
		}
	}

	describeSession(sessionId: string, meta: { sessionFile?: string; cwd?: string }): void {
		this.sessionMeta.set(sessionId, meta);
	}

	fileFor(context: TraceContext | undefined): CaptureFile {
		const sessionId = context?.sessionId;
		if (!sessionId) {
			if (!this.processFile) {
				this.processFile = new CaptureFile(
					join(this.dir, "process", `${fileTimestamp(this.startedAt)}_${process.pid}.jsonl`),
					{ maxBodyBytes: this.maxBodyBytes, rootDir: this.dir },
				);
				this.processFile.append({
					type: "trace_header",
					version: CAPTURE_FORMAT_VERSION,
					t: Date.now(),
					pid: process.pid,
					scope: "process",
					...(this.appVersion ? { appVersion: this.appVersion } : {}),
				});
			}
			return this.processFile;
		}
		let file = this.sessionFiles.get(sessionId);
		if (!file) {
			file = new CaptureFile(
				join(this.dir, "sessions", safeName(sessionId), `${fileTimestamp(Date.now())}_${process.pid}.jsonl`),
				{ maxBodyBytes: this.maxBodyBytes, rootDir: this.dir },
			);
			const meta = this.sessionMeta.get(sessionId);
			file.append({
				type: "trace_header",
				version: CAPTURE_FORMAT_VERSION,
				t: Date.now(),
				pid: process.pid,
				scope: "session",
				sessionId,
				...(meta?.sessionFile ? { sessionFile: meta.sessionFile } : {}),
				...(meta?.cwd ? { cwd: meta.cwd } : {}),
				...(this.appVersion ? { appVersion: this.appVersion } : {}),
			});
			this.sessionFiles.set(sessionId, file);
		}
		return file;
	}

	flushModelRequest(modelRequestId: string): void {
		this.network.flushModelRequest(modelRequestId);
	}

	createSessionTracer(options: SessionTracerOptions): SessionTracer {
		return new SessionTracer(this, options);
	}
}

export interface SessionTracerOptions {
	getSessionId(): string;
	getSessionFile(): string | undefined;
	cwd: string;
}

interface PendingModelRequest {
	id: string;
	t: number;
	perf: number;
	payloadText?: string;
	payloadAt?: number;
	response?: ModelRequestRecord["response"];
	events: string[];
	eventBytes: number;
	eventCount: number;
	eventsTruncated: boolean;
	payloadBytes?: number;
	payloadTruncated?: boolean;
	payloadNote?: string;
	/** Bytes reserved from the in-flight budget, released when the request is written. */
	reserved: number;
	firstEventPerf?: number;
	responsePerf?: number;
}

interface PendingTool {
	t: number;
	perf: number;
	args: unknown;
}

/**
 * Read at most `maxBytes` of a tool's full-output file. Only regular files in the temp directory
 * are read (where tools write full output), never through a symlink, so a tool result naming an
 * arbitrary path, a FIFO, or a device cannot make capture copy or block on it.
 */
function readFileCapped(
	path: string,
	maxBytes: number,
): { text: string; truncated: boolean; size: number } | undefined {
	let fd: number | undefined;
	try {
		const real = realpathSync(path);
		const tempRoot = realpathSync(tmpdir());
		const rel = relative(tempRoot, real);
		if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
		const linkStats = lstatSync(path);
		if (!linkStats.isFile()) return undefined;
		fd = openSync(real, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
		const stats = fstatSync(fd);
		if (!stats.isFile()) return undefined;
		const size = stats.size;
		const length = Math.min(size, maxBytes);
		const buffer = Buffer.alloc(length);
		const bytesRead = readSync(fd, buffer, 0, length, 0);
		return { text: buffer.subarray(0, bytesRead).toString("utf8"), truncated: length < size, size };
	} catch {
		return undefined;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function textContent(content: unknown): { text: string; images: number } {
	if (typeof content === "string") return { text: content, images: 0 };
	if (!Array.isArray(content)) return { text: "", images: 0 };
	const parts: string[] = [];
	let images = 0;
	for (const block of content) {
		if (block && typeof block === "object") {
			const typed = block as { type?: unknown; text?: unknown };
			if (typed.type === "text" && typeof typed.text === "string") parts.push(typed.text);
			else if (typed.type === "image") images++;
		}
	}
	return { text: parts.join("\n"), images };
}

/** Captures model requests and tool executions of one agent session. */
export class SessionTracer {
	private readonly recorder: TraceRecorder;
	private readonly options: SessionTracerOptions;
	private readonly tools = new Map<string, PendingTool>();

	constructor(recorder: TraceRecorder, options: SessionTracerOptions) {
		this.recorder = recorder;
		this.options = options;
	}

	private sessionId(): string {
		const sessionId = this.options.getSessionId();
		this.recorder.describeSession(sessionId, { sessionFile: this.options.getSessionFile(), cwd: this.options.cwd });
		return sessionId;
	}

	/**
	 * Run one model request with capture: the final payload (after extension hooks), response
	 * status and headers, raw provider stream events, and the assembled message. Network activity
	 * started by the request is attributed to it through async context.
	 */
	traceStream(
		model: { provider: string; api: string; id: string },
		options: ModelsSimpleStreamOptions,
		run: (options: ModelsSimpleStreamOptions) => AssistantMessageEventStream,
	): AssistantMessageEventStream {
		const recorder = this.recorder;
		const sessionId = this.sessionId();
		const pending: PendingModelRequest = {
			id: recorder.newId("m"),
			t: Date.now(),
			perf: performance.now(),
			events: [],
			eventBytes: 0,
			eventCount: 0,
			eventsTruncated: false,
			reserved: 0,
		};
		const wrapped: ModelsSimpleStreamOptions = {
			...options,
			onPayload: async (payload, requestModel) => {
				const replaced = await options.onPayload?.(payload, requestModel);
				try {
					pending.payloadAt = Date.now();
					const serialized = JSON.stringify(replaced ?? payload, null, 0) ?? "";
					pending.payloadBytes = Buffer.byteLength(serialized);
					const capped = capText(serialized, recorder.maxBodyBytes);
					const reserve = Buffer.byteLength(capped.text);
					if (recorder.budget.tryReserve(reserve)) {
						pending.reserved += reserve;
						pending.payloadText = recorder.redactor.text(capped.text);
						pending.payloadTruncated = capped.truncated;
						if (!capped.truncated) recorder.rememberPayload(pending.id, sha1(pending.payloadText));
					} else {
						pending.payloadNote = "in-flight capture memory budget exceeded";
					}
				} catch {
					// Unserializable payload; the network capture still has the bytes.
				}
				return replaced;
			},
			onResponse: async (response, requestModel) => {
				pending.responsePerf = performance.now();
				pending.response = {
					status: response.status,
					headers: recorder.redactor.headers(response.headers),
					t: Date.now(),
				};
				await options.onResponse?.(response, requestModel);
			},
			onProviderStreamEvent: async (data, requestModel) => {
				pending.firstEventPerf ??= performance.now();
				pending.eventCount++;
				if (!pending.eventsTruncated) {
					const line = safeJson({ t: Date.now(), data });
					const bytes = Buffer.byteLength(line);
					// Checked before keeping the line, so one huge event cannot pass the limit.
					if (pending.eventBytes + bytes <= recorder.maxBodyBytes && recorder.budget.tryReserve(bytes)) {
						pending.events.push(line);
						pending.eventBytes += bytes;
						pending.reserved += bytes;
					} else {
						pending.eventsTruncated = true;
					}
				}
				await options.onProviderStreamEvent?.(data, requestModel);
			},
		};
		const stream = recorder.runInContext({ sessionId, modelRequestId: pending.id }, () => run(wrapped));
		stream.result().then(
			(message) => this.finishModelRequest(sessionId, model, pending, message, undefined),
			(error: unknown) => this.finishModelRequest(sessionId, model, pending, undefined, error),
		);
		return stream;
	}

	private finishModelRequest(
		sessionId: string,
		model: { provider: string; api: string; id: string },
		pending: PendingModelRequest,
		message: unknown,
		error: unknown,
	): void {
		const recorder = this.recorder;
		try {
			recorder.flushModelRequest(pending.id);
			const file = recorder.fileFor({ sessionId });
			const final = (message ?? {}) as {
				stopReason?: string;
				errorMessage?: string;
				usage?: {
					input?: number;
					output?: number;
					cacheRead?: number;
					cacheWrite?: number;
					totalTokens?: number;
					cost?: { total?: number };
				};
				responseId?: string;
				responseModel?: string;
				model?: string;
				provider?: string;
				timestamp?: number;
			};
			const now = performance.now();
			const record: ModelRequestRecord = {
				type: "model_request",
				id: pending.id,
				t: pending.t,
				sessionId,
				provider: final.provider ?? model.provider,
				api: model.api,
				model: final.model ?? model.id,
				...(pending.payloadText !== undefined
					? {
							payload: file.body(`${pending.id}-payload`, pending.payloadText, {
								...(pending.payloadTruncated
									? { truncated: true, note: `cut from ${pending.payloadBytes} bytes at the capture limit` }
									: {}),
							}),
							payloadAt: pending.payloadAt,
						}
					: pending.payloadBytes !== undefined
						? {
								payload: { bytes: pending.payloadBytes, truncated: true, note: pending.payloadNote },
								payloadAt: pending.payloadAt,
							}
						: {}),
				...(pending.response ? { response: pending.response } : {}),
				...(pending.events.length > 0
					? {
							events: file.body(
								`${pending.id}-events`,
								recorder.redactor.text(pending.events.join("\n")),
								pending.eventsTruncated ? { truncated: true } : {},
							),
						}
					: pending.eventsTruncated
						? { events: { bytes: 0, truncated: true, note: "first event exceeds the capture limit or budget" } }
						: {}),
				eventCount: pending.eventCount,
				...(pending.firstEventPerf !== undefined
					? { firstEventAt: pending.t + Math.round(pending.firstEventPerf - pending.perf) }
					: {}),
				endedAt: Date.now(),
				durationMs: Math.round(now - pending.perf),
				...((pending.responsePerf ?? pending.firstEventPerf) !== undefined
					? { ttfbMs: Math.round((pending.responsePerf ?? pending.firstEventPerf ?? now) - pending.perf) }
					: {}),
				...(final.stopReason ? { stopReason: final.stopReason } : {}),
				...(final.errorMessage || error
					? { errorMessage: recorder.redactor.text(final.errorMessage ?? String(error)) }
					: {}),
				...(final.usage
					? {
							usage: {
								input: final.usage.input ?? 0,
								output: final.usage.output ?? 0,
								cacheRead: final.usage.cacheRead ?? 0,
								cacheWrite: final.usage.cacheWrite ?? 0,
								totalTokens: final.usage.totalTokens ?? 0,
								cost: final.usage.cost?.total ?? 0,
							},
						}
					: {}),
				...(final.responseId ? { responseId: final.responseId } : {}),
				...(final.responseModel ? { responseModel: final.responseModel } : {}),
				...(typeof final.timestamp === "number" ? { messageTimestamp: final.timestamp } : {}),
				...(message ? { message: this.cappedBody(file, `${pending.id}-message`, safeJson(message)) } : {}),
			};
			file.append(record);
		} catch {
			// Capture must never break the agent.
		} finally {
			recorder.budget.release(pending.reserved);
			pending.reserved = 0;
			pending.events = [];
			pending.payloadText = undefined;
		}
	}

	/** Cut to the body limit first, then redact, then store: redaction never runs on unbounded text. */
	private cappedBody(file: CaptureFile, name: string, value: string): BodyRef {
		const capped = capText(value, this.recorder.maxBodyBytes);
		return file.body(name, this.recorder.redactor.text(capped.text), capped.truncated ? { truncated: true } : {});
	}

	/** Agent event listener: records tool executions. */
	onAgentEvent(event: AgentEvent): void {
		try {
			if (event.type === "tool_execution_start") {
				this.tools.set(event.toolCallId, { t: Date.now(), perf: performance.now(), args: event.args });
			} else if (event.type === "tool_execution_end") {
				const started = this.tools.get(event.toolCallId);
				this.tools.delete(event.toolCallId);
				this.writeTool(event, started);
			}
		} catch {
			// Capture must never break the agent.
		}
	}

	private writeTool(
		event: Extract<AgentEvent, { type: "tool_execution_end" }>,
		started: PendingTool | undefined,
	): void {
		const recorder = this.recorder;
		const sessionId = this.sessionId();
		const file = recorder.fileFor({ sessionId });
		const id = recorder.newId("t");
		const result = (event.result ?? {}) as {
			content?: unknown;
			details?: unknown;
			structuredContent?: { exit_code?: unknown; full_output_path?: unknown };
		};
		const { text, images } = textContent(result.content);
		const body = (name: string, value: string) => this.cappedBody(file, `${id}-${name}`, value);
		const details = result.details as { fullOutputPath?: unknown; exitCode?: unknown } | undefined;
		const fullOutputPath =
			typeof details?.fullOutputPath === "string"
				? details.fullOutputPath
				: typeof result.structuredContent?.full_output_path === "string"
					? result.structuredContent.full_output_path
					: undefined;
		const exitCode =
			typeof result.structuredContent?.exit_code === "number"
				? result.structuredContent.exit_code
				: typeof details?.exitCode === "number"
					? details.exitCode
					: undefined;
		const full = fullOutputPath ? readFileCapped(fullOutputPath, recorder.maxBodyBytes) : undefined;
		const endedAt = Date.now();
		const record: ToolExecutionRecord = {
			type: "tool_execution",
			id,
			t: started?.t ?? endedAt,
			sessionId,
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			cwd: this.options.cwd,
			...(started ? { args: body("args", safeJson(started.args)) } : {}),
			content: body("content", text),
			...(images ? { images } : {}),
			...(result.details !== undefined ? { details: body("details", safeJson(result.details)) } : {}),
			...(full
				? {
						fullOutput: file.body(
							`${id}-full`,
							recorder.redactor.text(full.text),
							full.truncated ? { truncated: true } : {},
						),
						fullOutputPath,
					}
				: {}),
			...(exitCode !== undefined ? { exitCode } : {}),
			isError: event.isError,
			endedAt,
			durationMs: started ? Math.round(performance.now() - started.perf) : 0,
		};
		file.append(record);
	}
}
