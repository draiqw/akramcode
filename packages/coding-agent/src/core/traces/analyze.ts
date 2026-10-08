/**
 * Pure analysis of session JSONL entries for `akramcode traces`: per-session summaries, a
 * display timeline, and aggregates across sessions. Input is untrusted parsed JSON, so every
 * field is read defensively; a malformed entry degrades to "other" instead of throwing.
 */

import { stripAnsi } from "../../utils/ansi.ts";

/** Longest text kept per timeline field; the raw JSONL export keeps everything. */
export const TIMELINE_TEXT_LIMIT = 20_000;
const SYSTEM_TEXT_LIMIT = 4_000;
const SEARCH_TEXT_LIMIT = 16_000;
const FIRST_MESSAGE_LIMIT = 300;
const ERROR_MESSAGE_LIMIT = 500;
const LATENCY_SAMPLE_LIMIT = 200;
const SLOW_TOOL_CALLS_KEPT = 5;
const MAX_ERROR_GROUPS_PER_SESSION = 200;
/** Latencies above a day come from clock jumps or resumed sessions, not model responses. */
const MAX_PLAUSIBLE_LATENCY_MS = 24 * 60 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

export interface TraceTokens {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

export interface TraceToolStat {
	calls: number;
	errors: number;
	/** Calls with a measured duration. */
	timed: number;
	totalMs: number;
	maxMs: number;
}

export interface TraceErrorGroup {
	signature: string;
	kind: "tool" | "assistant";
	tool?: string;
	count: number;
	example: string;
	entryId?: string;
}

export interface TraceSlowCall {
	tool: string;
	ms: number;
	entryId?: string;
}

export interface TraceSessionSummary {
	/** Stable id derived from the file path. */
	key: string;
	path: string;
	sessionId: string;
	cwd: string;
	name?: string;
	version: number;
	/** Fork source from the session header. */
	forkParentPath?: string;
	forkParentKey?: string;
	/** Set for subagent transcripts stored in `<parent>.subagents/`. */
	isSubagent: boolean;
	parentKey?: string;
	childKeys: string[];
	startedAt: number;
	lastActivityAt: number;
	durationMs: number;
	sizeBytes: number;
	mtimeMs: number;
	entryCount: number;
	malformedLines: number;
	firstMessage: string;
	searchText: string;
	models: string[];
	primaryModel?: string;
	thinkingLevels: string[];
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolErrors: number;
	assistantErrors: number;
	abortedMessages: number;
	/** Tool calls that never got a result (crash, kill, or abort mid-tool). */
	orphanToolCalls: number;
	retries: number;
	contextOmissions: number;
	compactions: number;
	branchSummaries: number;
	branchPoints: number;
	offPathEntries: number;
	taskNotifications: number;
	subagentCalls: number;
	lastStopReason?: string;
	stopReasons: Record<string, number>;
	tokens: TraceTokens;
	cost: number;
	latency: { count: number; totalMs: number; maxMs: number };
	latencySamples: number[];
	maxToolErrorStreak: number;
	tools: Record<string, TraceToolStat>;
	errorGroups: TraceErrorGroup[];
	slowestToolCalls: TraceSlowCall[];
}

/** Summary without the fields only aggregation needs; what the session list returns. */
export type TraceSessionListItem = Omit<
	TraceSessionSummary,
	"searchText" | "latencySamples" | "tools" | "errorGroups" | "slowestToolCalls"
>;

export interface TraceTextBlock {
	type: "text" | "thinking";
	text: string;
	truncated?: number;
	redacted?: boolean;
}

export interface TraceToolCallBlock {
	type: "toolCall";
	id: string;
	name: string;
	args: string;
	truncated?: number;
}

export type TraceBlock = TraceTextBlock | TraceToolCallBlock;

export type TraceEventKind =
	| "user"
	| "assistant"
	| "toolResult"
	| "system"
	| "bash"
	| "custom_message"
	| "compaction"
	| "branch_summary"
	| "model_change"
	| "thinking_level_change"
	| "usage"
	| "context_edit"
	| "label"
	| "session_info"
	| "custom"
	| "other";

export interface TraceEvent {
	index: number;
	kind: TraceEventKind;
	id?: string;
	parentId?: string | null;
	/** Milliseconds since epoch. */
	timestamp?: number;
	/** Not on the path from the last entry to the root (an abandoned branch). */
	offPath?: boolean;
	/** Has more than one child. */
	branchPoint?: boolean;
	/** Removed from model context by a later `context_edit` (for example a retried failed attempt). */
	omitted?: boolean;
	role?: string;
	text?: string;
	truncated?: number;
	images?: number;
	blocks?: TraceBlock[];
	model?: string;
	thinkingLevel?: string;
	usage?: TraceTokens;
	cost?: number;
	stopReason?: string;
	errorMessage?: string;
	latencyMs?: number;
	/** Assistant message timestamp (request start); links the entry to captured model requests. */
	messageTimestamp?: number;
	responseId?: string;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	durationMs?: number;
	/** Subagent transcript referenced by an `agent` tool result or task notification. */
	childPath?: string;
	childKey?: string;
	customType?: string;
	display?: boolean;
	command?: string;
	exitCode?: number | null;
	tokensBefore?: number;
	label?: string;
	targetId?: string;
	sections?: string[];
	toolsAdded?: string[];
	toolsRemoved?: string[];
	/** JSON preview of custom data or details. */
	data?: string;
}

export interface TraceFileMeta {
	key: string;
	path: string;
	sizeBytes: number;
	mtimeMs: number;
	malformedLines: number;
	isSubagent: boolean;
}

// =============================================================================
// Field helpers
// =============================================================================

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseTime(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return undefined;
	const time = Date.parse(value);
	return Number.isNaN(time) ? undefined : time;
}

function clip(text: string, limit: number): { text: string; truncated?: number } {
	if (text.length <= limit) return { text };
	return { text: text.slice(0, limit), truncated: text.length - limit };
}

function oneLine(text: string, limit: number): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/** Text of a string or a content-block array; counts image blocks. */
function contentText(content: unknown): { text: string; images: number } {
	if (typeof content === "string") return { text: content, images: 0 };
	if (!Array.isArray(content)) return { text: "", images: 0 };
	const parts: string[] = [];
	let images = 0;
	for (const block of content) {
		if (!isRecord(block)) continue;
		if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
		else if (block.type === "image") images++;
	}
	return { text: parts.join("\n"), images };
}

function emptyTokens(): TraceTokens {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function readUsage(value: unknown): { tokens: TraceTokens; cost: number } | undefined {
	if (!isRecord(value)) return undefined;
	const input = num(value.input) ?? 0;
	const output = num(value.output) ?? 0;
	const cacheRead = num(value.cacheRead) ?? 0;
	const cacheWrite = num(value.cacheWrite) ?? 0;
	const total = num(value.totalTokens) ?? input + output + cacheRead + cacheWrite;
	const cost = isRecord(value.cost) ? (num(value.cost.total) ?? 0) : (num(value.cost) ?? 0);
	return { tokens: { input, output, cacheRead, cacheWrite, total }, cost };
}

function addTokens(target: TraceTokens, add: TraceTokens): void {
	target.input += add.input;
	target.output += add.output;
	target.cacheRead += add.cacheRead;
	target.cacheWrite += add.cacheWrite;
	target.total += add.total;
}

function safeJson(value: unknown, indent?: number): string {
	try {
		return JSON.stringify(value, null, indent) ?? "";
	} catch {
		return String(value);
	}
}

/**
 * Collapse the variable parts of an error message so equal failures group together:
 * paths, quoted strings, ids, and numbers become placeholders.
 */
export function normalizeErrorMessage(message: string): string {
	const firstLine =
		stripAnsi(message)
			.split("\n")
			.map((line) => line.trim())
			.find((line) => line.length > 0) ?? "";
	return oneLine(
		firstLine
			.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
			.replace(/(?:[A-Za-z]:)?(?:~|\.{1,2})?(?:[\\/][^\s"'`,:;()[\]{}<>]+)+/g, "<path>")
			.replace(/"[^"]*"/g, '"…"')
			.replace(/'[^']*'/g, "'…'")
			.replace(/`[^`]*`/g, "`…`")
			.replace(/\b0x[0-9a-f]+\b/gi, "N")
			.replace(/\b[0-9a-f]{12,}\b/gi, "<id>")
			.replace(/\d+(?:\.\d+)?/g, "N"),
		160,
	);
}

/** Transcript path in `agent` tool details or task notification details, if any. */
function findTranscriptPath(details: unknown): string | undefined {
	if (!isRecord(details)) return undefined;
	const direct = str(details.transcriptFile);
	if (direct) return direct;
	if (isRecord(details.task)) return str(details.task.transcriptFile);
	return undefined;
}

// =============================================================================
// Session analysis
// =============================================================================

interface PendingToolCall {
	name: string;
	startedAt?: number;
	entryId?: string;
}

/**
 * Builds the summary and timeline of one session from its entries in file order. Entries are
 * fed one at a time so large files never need to be held in memory as raw JSON.
 */
export class SessionAnalyzer {
	private readonly meta: TraceFileMeta;
	private readonly withTimeline: boolean;
	private header: JsonRecord | undefined;
	private readonly events: TraceEvent[] = [];
	private readonly eventById = new Map<string, TraceEvent>();
	private readonly parentById = new Map<string, string | null>();
	private readonly childCount = new Map<string, number>();
	private readonly pendingToolCalls = new Map<string, PendingToolCall>();
	private readonly assistantErrorIds = new Set<string>();
	private readonly omittedIds = new Set<string>();
	private readonly modelCounts = new Map<string, number>();
	private readonly thinkingLevels = new Set<string>();
	private readonly errorGroups = new Map<string, TraceErrorGroup>();
	private readonly searchParts: string[] = [];
	private searchLength = 0;
	private lastEntryId: string | undefined;
	private firstTime: number | undefined;
	private lastTime: number | undefined;
	private lastActivity: number | undefined;
	private currentStreak = 0;
	private name: string | undefined;
	private firstMessage = "";
	private latestModelChange: string | undefined;
	private entryCount = 0;
	private readonly summary: Omit<
		TraceSessionSummary,
		| "key"
		| "path"
		| "sessionId"
		| "cwd"
		| "version"
		| "isSubagent"
		| "childKeys"
		| "startedAt"
		| "lastActivityAt"
		| "durationMs"
		| "sizeBytes"
		| "mtimeMs"
		| "entryCount"
		| "malformedLines"
		| "firstMessage"
		| "searchText"
		| "models"
		| "thinkingLevels"
		| "errorGroups"
		| "branchPoints"
		| "offPathEntries"
	> = {
		userMessages: 0,
		assistantMessages: 0,
		toolCalls: 0,
		toolErrors: 0,
		assistantErrors: 0,
		abortedMessages: 0,
		orphanToolCalls: 0,
		retries: 0,
		contextOmissions: 0,
		compactions: 0,
		branchSummaries: 0,
		taskNotifications: 0,
		subagentCalls: 0,
		stopReasons: {},
		tokens: emptyTokens(),
		cost: 0,
		latency: { count: 0, totalMs: 0, maxMs: 0 },
		latencySamples: [],
		maxToolErrorStreak: 0,
		tools: {},
		slowestToolCalls: [],
	};

	constructor(meta: TraceFileMeta, options: { timeline: boolean }) {
		this.meta = meta;
		this.withTimeline = options.timeline;
	}

	/** Feed the header line. Returns false when it is not a session header. */
	setHeader(entry: unknown): boolean {
		if (!isRecord(entry) || entry.type !== "session" || typeof entry.id !== "string") return false;
		this.header = entry;
		const time = parseTime(entry.timestamp);
		if (time !== undefined) this.firstTime = time;
		return true;
	}

	add(raw: unknown): void {
		if (!isRecord(raw)) return;
		this.entryCount++;
		const entry = raw;
		const id = str(entry.id);
		const parentId = entry.parentId === null ? null : str(entry.parentId);
		const timestamp = parseTime(entry.timestamp);
		if (timestamp !== undefined) {
			this.firstTime ??= timestamp;
			this.lastTime = timestamp;
		}
		if (id) {
			this.parentById.set(id, parentId ?? null);
			if (parentId) this.childCount.set(parentId, (this.childCount.get(parentId) ?? 0) + 1);
			this.lastEntryId = id;
		}

		const event: TraceEvent = { index: this.events.length, kind: "other", id, parentId, timestamp };
		switch (entry.type) {
			case "message":
				this.addMessage(entry, event, timestamp);
				break;
			case "compaction": {
				this.summary.compactions++;
				event.kind = "compaction";
				Object.assign(event, clip(str(entry.summary) ?? "", TIMELINE_TEXT_LIMIT));
				event.tokensBefore = num(entry.tokensBefore);
				this.addSideUsage(entry.usage, event);
				break;
			}
			case "branch_summary": {
				this.summary.branchSummaries++;
				event.kind = "branch_summary";
				Object.assign(event, clip(str(entry.summary) ?? "", TIMELINE_TEXT_LIMIT));
				event.targetId = str(entry.fromId);
				this.addSideUsage(entry.usage, event);
				break;
			}
			case "model_change": {
				event.kind = "model_change";
				const provider = str(entry.provider);
				const modelId = str(entry.modelId);
				event.model = provider && modelId ? `${provider}/${modelId}` : (modelId ?? provider);
				this.latestModelChange = event.model;
				break;
			}
			case "thinking_level_change":
				event.kind = "thinking_level_change";
				event.thinkingLevel = str(entry.thinkingLevel);
				if (event.thinkingLevel) this.thinkingLevels.add(event.thinkingLevel);
				break;
			case "usage": {
				event.kind = "usage";
				event.customType = str(entry.kind);
				const provider = str(entry.provider);
				const model = str(entry.model);
				event.model = provider && model ? `${provider}/${model}` : model;
				this.addSideUsage(entry.usage, event);
				break;
			}
			case "context_edit": {
				event.kind = "context_edit";
				const targetId = str(entry.targetId);
				event.targetId = targetId;
				if (entry.replacement === null && targetId) {
					this.summary.contextOmissions++;
					this.omittedIds.add(targetId);
					// A failed attempt omitted from context is how auto-retry records a retry.
					if (this.assistantErrorIds.has(targetId)) this.summary.retries++;
					const target = this.eventById.get(targetId);
					if (target) target.omitted = true;
				} else if (isRecord(entry.replacement)) {
					event.text = clip(contentText(entry.replacement.content).text, TIMELINE_TEXT_LIMIT).text;
				}
				break;
			}
			case "label":
				event.kind = "label";
				event.targetId = str(entry.targetId);
				event.label = str(entry.label);
				break;
			case "session_info":
				event.kind = "session_info";
				this.name = str(entry.name)?.trim() || undefined;
				event.text = this.name ?? "";
				break;
			case "custom_message": {
				event.kind = "custom_message";
				event.customType = str(entry.customType);
				event.display = entry.display === true;
				const { text, images } = contentText(entry.content);
				Object.assign(event, clip(text, TIMELINE_TEXT_LIMIT));
				if (images) event.images = images;
				if (event.customType === "task-notification") {
					this.summary.taskNotifications++;
					event.childPath = findTranscriptPath(entry.details);
				}
				if (entry.details !== undefined) event.data = clip(safeJson(entry.details, 2), SYSTEM_TEXT_LIMIT).text;
				break;
			}
			case "custom":
				event.kind = "custom";
				event.customType = str(entry.customType);
				if (entry.data !== undefined) event.data = clip(safeJson(entry.data, 2), SYSTEM_TEXT_LIMIT).text;
				break;
			default:
				event.data = clip(safeJson(entry, 2), SYSTEM_TEXT_LIMIT).text;
				break;
		}

		if (this.withTimeline) {
			this.events.push(event);
			if (id) this.eventById.set(id, event);
		}
	}

	private addSideUsage(value: unknown, event: TraceEvent): void {
		const usage = readUsage(value);
		if (!usage) return;
		addTokens(this.summary.tokens, usage.tokens);
		this.summary.cost += usage.cost;
		event.usage = usage.tokens;
		event.cost = usage.cost;
	}

	private addSearchText(text: string): void {
		if (this.searchLength >= SEARCH_TEXT_LIMIT || !text) return;
		const part = text.slice(0, SEARCH_TEXT_LIMIT - this.searchLength);
		this.searchParts.push(part);
		this.searchLength += part.length + 1;
	}

	private addErrorGroup(kind: "tool" | "assistant", message: string, tool: string | undefined, entryId?: string) {
		const signature = normalizeErrorMessage(message) || "(empty error)";
		const groupKey = `${kind}\u0000${tool ?? ""}\u0000${signature}`;
		const existing = this.errorGroups.get(groupKey);
		if (existing) {
			existing.count++;
			return;
		}
		if (this.errorGroups.size >= MAX_ERROR_GROUPS_PER_SESSION) return;
		this.errorGroups.set(groupKey, {
			signature,
			kind,
			...(tool ? { tool } : {}),
			count: 1,
			example: oneLine(stripAnsi(message), ERROR_MESSAGE_LIMIT),
			...(entryId ? { entryId } : {}),
		});
	}

	private addMessage(entry: JsonRecord, event: TraceEvent, entryTime: number | undefined): void {
		const message = entry.message;
		if (!isRecord(message)) return;
		const role = str(message.role) ?? "unknown";
		event.role = role;
		const messageTime = num(message.timestamp);
		switch (role) {
			case "user": {
				this.summary.userMessages++;
				event.kind = "user";
				const { text, images } = contentText(message.content);
				Object.assign(event, clip(text, TIMELINE_TEXT_LIMIT));
				if (images) event.images = images;
				if (!this.firstMessage && text.trim()) this.firstMessage = oneLine(text, FIRST_MESSAGE_LIMIT);
				this.addSearchText(text);
				this.lastActivity = messageTime ?? entryTime ?? this.lastActivity;
				break;
			}
			case "assistant":
				this.addAssistant(message, event, entryTime, messageTime);
				break;
			case "toolResult":
				this.addToolResult(message, event, messageTime ?? entryTime);
				break;
			case "system": {
				event.kind = "system";
				const sections = isRecord(message.sections) ? message.sections : undefined;
				if (sections) event.sections = Object.keys(sections);
				const names = (list: unknown) =>
					Array.isArray(list) ? list.map((tool) => (isRecord(tool) ? str(tool.name) : undefined) ?? "?") : [];
				event.toolsAdded = names(message.toolsAdded);
				event.toolsRemoved = names(message.toolsRemoved);
				const text =
					contentText(message.content).text ||
					(sections
						? Object.entries(sections)
								.filter(([, value]) => typeof value === "string")
								.map(([name, value]) => `## ${name}\n${value as string}`)
								.join("\n\n")
						: "");
				Object.assign(event, clip(text, SYSTEM_TEXT_LIMIT));
				break;
			}
			case "bashExecution": {
				event.kind = "bash";
				event.command = str(message.command);
				event.exitCode = num(message.exitCode) ?? null;
				Object.assign(event, clip(stripAnsi(str(message.output) ?? ""), TIMELINE_TEXT_LIMIT));
				event.isError = message.cancelled === true || (event.exitCode !== null && event.exitCode !== 0);
				this.addSearchText(event.command ?? "");
				break;
			}
			default: {
				// custom, branchSummary, compactionSummary and future roles.
				event.kind = "custom_message";
				event.customType = str(message.customType) ?? role;
				const { text, images } = contentText(message.content ?? message.summary);
				Object.assign(event, clip(text, TIMELINE_TEXT_LIMIT));
				if (images) event.images = images;
				break;
			}
		}
	}

	private addAssistant(
		message: JsonRecord,
		event: TraceEvent,
		entryTime: number | undefined,
		messageTime: number | undefined,
	): void {
		this.summary.assistantMessages++;
		event.kind = "assistant";
		const provider = str(message.provider);
		const model = str(message.model);
		event.model = provider && model ? `${provider}/${model}` : model;
		if (event.model) this.modelCounts.set(event.model, (this.modelCounts.get(event.model) ?? 0) + 1);
		event.thinkingLevel = str(message.thinkingLevel);
		if (event.thinkingLevel) this.thinkingLevels.add(event.thinkingLevel);
		const stopReason = str(message.stopReason) ?? "unknown";
		event.stopReason = stopReason;
		this.summary.stopReasons[stopReason] = (this.summary.stopReasons[stopReason] ?? 0) + 1;
		this.summary.lastStopReason = stopReason;
		event.errorMessage = str(message.errorMessage);
		event.messageTimestamp = messageTime;
		event.responseId = str(message.responseId);
		this.lastActivity = messageTime ?? entryTime ?? this.lastActivity;

		const usage = readUsage(message.usage);
		if (usage) {
			addTokens(this.summary.tokens, usage.tokens);
			this.summary.cost += usage.cost;
			event.usage = usage.tokens;
			event.cost = usage.cost;
		}

		// The message timestamp is taken when the request starts; the entry is written when it ends.
		if (messageTime !== undefined && entryTime !== undefined) {
			const latency = entryTime - messageTime;
			if (latency >= 0 && latency < MAX_PLAUSIBLE_LATENCY_MS) {
				event.latencyMs = latency;
				const stats = this.summary.latency;
				stats.count++;
				stats.totalMs += latency;
				stats.maxMs = Math.max(stats.maxMs, latency);
				if (this.summary.latencySamples.length < LATENCY_SAMPLE_LIMIT) this.summary.latencySamples.push(latency);
			}
		}

		if (stopReason === "error") {
			this.summary.assistantErrors++;
			if (event.id) this.assistantErrorIds.add(event.id);
			this.addErrorGroup("assistant", event.errorMessage ?? "Unknown error", undefined, event.id);
			this.addSearchText((event.errorMessage ?? "").slice(0, ERROR_MESSAGE_LIMIT));
		} else if (stopReason === "aborted") {
			this.summary.abortedMessages++;
		}

		const blocks: TraceBlock[] = [];
		const content = Array.isArray(message.content) ? message.content : [];
		for (const block of content) {
			if (!isRecord(block)) continue;
			if (block.type === "text" && typeof block.text === "string") {
				blocks.push({ type: "text", ...clip(block.text, TIMELINE_TEXT_LIMIT) });
				this.addSearchText(block.text);
			} else if (block.type === "thinking") {
				blocks.push({
					type: "thinking",
					...clip(str(block.thinking) ?? "", TIMELINE_TEXT_LIMIT),
					...(block.redacted === true ? { redacted: true } : {}),
				});
			} else if (block.type === "toolCall") {
				const callId = str(block.id) ?? `call-${this.summary.toolCalls}`;
				const name = str(block.name) ?? "unknown";
				this.summary.toolCalls++;
				if (name === "agent") this.summary.subagentCalls++;
				const stat = this.toolStat(name);
				stat.calls++;
				this.pendingToolCalls.set(callId, { name, startedAt: entryTime, entryId: event.id });
				const args = clip(safeJson(block.arguments ?? {}, 2), TIMELINE_TEXT_LIMIT);
				this.addSearchText(`${name} ${args.text.slice(0, 200)}`);
				blocks.push({ type: "toolCall", id: callId, name, args: args.text, truncated: args.truncated });
			}
		}
		event.blocks = blocks;
	}

	private toolStat(name: string): TraceToolStat {
		const tools = this.summary.tools;
		if (!Object.hasOwn(tools, name)) tools[name] = { calls: 0, errors: 0, timed: 0, totalMs: 0, maxMs: 0 };
		return tools[name];
	}

	private addToolResult(message: JsonRecord, event: TraceEvent, resultTime: number | undefined): void {
		event.kind = "toolResult";
		const callId = str(message.toolCallId);
		event.toolCallId = callId;
		const pending = callId ? this.pendingToolCalls.get(callId) : undefined;
		if (callId) this.pendingToolCalls.delete(callId);
		const name = str(message.toolName) ?? pending?.name ?? "unknown";
		event.toolName = name;
		const isError = message.isError === true;
		event.isError = isError;
		const { text, images } = contentText(message.content);
		const clean = stripAnsi(text);
		Object.assign(event, clip(clean, TIMELINE_TEXT_LIMIT));
		if (images) event.images = images;
		event.childPath = findTranscriptPath(message.details);
		if (message.details !== undefined && name !== "agent") {
			const details = safeJson(message.details, 2);
			if (details && details !== "{}") event.data = clip(details, SYSTEM_TEXT_LIMIT).text;
		}

		// A result without a matching call still counts toward the tool so error rates stay honest.
		const stat = this.toolStat(name);
		if (!pending) stat.calls++;
		if (pending?.startedAt !== undefined && resultTime !== undefined) {
			const ms = resultTime - pending.startedAt;
			if (ms >= 0 && ms < MAX_PLAUSIBLE_LATENCY_MS) {
				event.durationMs = ms;
				stat.timed++;
				stat.totalMs += ms;
				stat.maxMs = Math.max(stat.maxMs, ms);
				this.recordSlowCall({ tool: name, ms, entryId: event.id });
			}
		}
		if (isError) {
			stat.errors++;
			this.summary.toolErrors++;
			this.currentStreak++;
			this.summary.maxToolErrorStreak = Math.max(this.summary.maxToolErrorStreak, this.currentStreak);
			this.addErrorGroup("tool", clean || "(no output)", name, event.id);
			this.addSearchText(clean.slice(0, ERROR_MESSAGE_LIMIT));
		} else {
			this.currentStreak = 0;
		}
	}

	private recordSlowCall(call: TraceSlowCall): void {
		const list = this.summary.slowestToolCalls;
		list.push(call);
		list.sort((a, b) => b.ms - a.ms);
		if (list.length > SLOW_TOOL_CALLS_KEPT) list.length = SLOW_TOOL_CALLS_KEPT;
	}

	/** Ids on the path from the last entry back to the root. */
	private activePath(): Set<string> {
		const path = new Set<string>();
		let current = this.lastEntryId;
		while (current && !path.has(current)) {
			path.add(current);
			current = this.parentById.get(current) ?? undefined;
		}
		return path;
	}

	finish(): { summary: TraceSessionSummary; events: TraceEvent[] } {
		const header = this.header ?? {};
		const activePath = this.activePath();
		let branchPoints = 0;
		for (const count of this.childCount.values()) if (count > 1) branchPoints++;
		let offPathEntries = 0;
		for (const id of this.parentById.keys()) if (!activePath.has(id)) offPathEntries++;
		if (this.withTimeline) {
			for (const event of this.events) {
				if (!event.id) continue;
				if (!activePath.has(event.id)) event.offPath = true;
				if ((this.childCount.get(event.id) ?? 0) > 1) event.branchPoint = true;
				if (this.omittedIds.has(event.id)) event.omitted = true;
			}
		}

		const models = [...this.modelCounts.entries()].sort((a, b) => b[1] - a[1]).map(([model]) => model);
		if (models.length === 0 && this.latestModelChange) models.push(this.latestModelChange);
		const startedAt = parseTime(header.timestamp) ?? this.firstTime ?? this.meta.mtimeMs;
		const lastActivityAt = Math.max(this.lastActivity ?? this.lastTime ?? startedAt, startedAt);
		const cwd = str(header.cwd) ?? "";
		const name = this.name;
		const searchText = [name ?? "", cwd, str(header.id) ?? "", models.join(" "), ...this.searchParts]
			.join("\n")
			.toLowerCase();

		const summary: TraceSessionSummary = {
			key: this.meta.key,
			path: this.meta.path,
			sessionId: str(header.id) ?? "",
			cwd,
			...(name ? { name } : {}),
			version: num(header.version) ?? 1,
			...(str(header.parentSession) ? { forkParentPath: str(header.parentSession) } : {}),
			isSubagent: this.meta.isSubagent,
			childKeys: [],
			startedAt,
			lastActivityAt,
			durationMs: Math.max(0, (this.lastTime ?? startedAt) - startedAt),
			sizeBytes: this.meta.sizeBytes,
			mtimeMs: this.meta.mtimeMs,
			entryCount: this.entryCount,
			malformedLines: this.meta.malformedLines,
			firstMessage: this.firstMessage || "(no user message)",
			searchText,
			models,
			...(models[0] ? { primaryModel: models[0] } : {}),
			thinkingLevels: [...this.thinkingLevels],
			...this.summary,
			orphanToolCalls: this.pendingToolCalls.size,
			errorGroups: [...this.errorGroups.values()],
			branchPoints,
			offPathEntries,
		};
		return { summary, events: this.events };
	}
}

/** Analyze an in-memory list of file entries (header first). Returns undefined for non-session input. */
export function analyzeEntries(
	entries: readonly unknown[],
	meta: TraceFileMeta,
	options: { timeline: boolean } = { timeline: true },
): { summary: TraceSessionSummary; events: TraceEvent[] } | undefined {
	const analyzer = new SessionAnalyzer(meta, options);
	if (!analyzer.setHeader(entries[0])) return undefined;
	for (let i = 1; i < entries.length; i++) analyzer.add(entries[i]);
	return analyzer.finish();
}

export function toListItem(summary: TraceSessionSummary): TraceSessionListItem {
	const {
		searchText: _searchText,
		latencySamples: _latencySamples,
		tools: _tools,
		errorGroups: _errorGroups,
		slowestToolCalls: _slowestToolCalls,
		...item
	} = summary;
	return item;
}

// =============================================================================
// Filtering
// =============================================================================

export interface TraceFilter {
	q?: string;
	project?: string;
	model?: string;
	errors?: boolean;
	/** Inclusive lower bound, ms since epoch. */
	from?: number;
	/** Exclusive upper bound, ms since epoch. */
	to?: number;
	subagents?: "include" | "exclude" | "only";
}

export function sessionHasErrors(summary: TraceSessionListItem): boolean {
	return summary.toolErrors > 0 || summary.assistantErrors > 0;
}

/** Parse filter query parameters. Dates accept `YYYY-MM-DD` (local day) or any `Date.parse` input. */
export function parseTraceFilter(params: URLSearchParams): TraceFilter {
	const filter: TraceFilter = {};
	const q = params.get("q")?.trim();
	if (q) filter.q = q;
	const project = params.get("project");
	if (project) filter.project = project;
	const model = params.get("model");
	if (model) filter.model = model;
	const errors = params.get("errors");
	if (errors === "1" || errors === "true") filter.errors = true;
	const parseDay = (value: string | null, endOfDay: boolean): number | undefined => {
		if (!value) return undefined;
		const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
		if (day) {
			const date = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]) + (endOfDay ? 1 : 0));
			return date.getTime();
		}
		const time = Date.parse(value);
		return Number.isNaN(time) ? undefined : time;
	};
	const from = parseDay(params.get("from"), false);
	if (from !== undefined) filter.from = from;
	const to = parseDay(params.get("to"), true);
	if (to !== undefined) filter.to = to;
	const subagents = params.get("subagents");
	if (subagents === "exclude" || subagents === "only" || subagents === "include") filter.subagents = subagents;
	return filter;
}

export function filterSummaries(summaries: readonly TraceSessionSummary[], filter: TraceFilter): TraceSessionSummary[] {
	const terms = filter.q?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
	const model = filter.model?.toLowerCase();
	return summaries.filter((summary) => {
		if (filter.project !== undefined && summary.cwd !== filter.project) return false;
		if (model && !summary.models.some((candidate) => candidate.toLowerCase().includes(model))) return false;
		if (filter.errors && !sessionHasErrors(summary)) return false;
		if (filter.from !== undefined && summary.lastActivityAt < filter.from) return false;
		if (filter.to !== undefined && summary.startedAt >= filter.to) return false;
		if (filter.subagents === "exclude" && summary.isSubagent) return false;
		if (filter.subagents === "only" && !summary.isSubagent) return false;
		for (const term of terms) {
			if (!summary.searchText.includes(term) && !summary.firstMessage.toLowerCase().includes(term)) return false;
		}
		return true;
	});
}

// =============================================================================
// Aggregation
// =============================================================================

export interface TraceToolAggregate {
	name: string;
	calls: number;
	errors: number;
	errorRate: number;
	avgMs?: number;
	maxMs: number;
	sessions: number;
}

export interface TraceErrorGroupAggregate {
	signature: string;
	kind: "tool" | "assistant";
	tool?: string;
	count: number;
	sessions: number;
	example: string;
	examples: Array<{ key: string; entryId?: string }>;
}

export interface TraceModelAggregate {
	model: string;
	sessions: number;
	assistantMessages: number;
	assistantErrors: number;
	toolCalls: number;
	toolErrors: number;
	tokens: number;
	cost: number;
	avgLatencyMs?: number;
}

export interface TraceStrugglingSession {
	key: string;
	score: number;
	cwd: string;
	firstMessage: string;
	primaryModel?: string;
	startedAt: number;
	toolErrors: number;
	assistantErrors: number;
	retries: number;
	maxToolErrorStreak: number;
	abortedMessages: number;
	orphanToolCalls: number;
}

export interface TraceAggregate {
	sessions: number;
	sessionsWithErrors: number;
	subagentSessions: number;
	abortedSessions: number;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolErrors: number;
	toolErrorRate: number;
	assistantErrors: number;
	abortedMessages: number;
	orphanToolCalls: number;
	retries: number;
	compactions: number;
	tokens: TraceTokens;
	cost: number;
	avgUserMessages: number;
	avgAssistantMessages: number;
	avgToolCalls: number;
	avgDurationMs: number;
	latency: { count: number; avgMs?: number; p50Ms?: number; p90Ms?: number; maxMs: number };
	stopReasons: Record<string, number>;
	tools: TraceToolAggregate[];
	errorGroups: TraceErrorGroupAggregate[];
	models: TraceModelAggregate[];
	struggling: TraceStrugglingSession[];
	slowestToolCalls: Array<TraceSlowCall & { key: string }>;
	daily: Array<{
		day: string;
		sessions: number;
		sessionsWithErrors: number;
		toolCalls: number;
		toolErrors: number;
		cost: number;
	}>;
}

function percentile(sorted: readonly number[], fraction: number): number | undefined {
	if (sorted.length === 0) return undefined;
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
	return sorted[index];
}

function localDay(time: number): string {
	const date = new Date(time);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Score of how much a session struggled; higher means more failures worth a look. */
export function struggleScore(summary: TraceSessionSummary): number {
	return (
		summary.toolErrors +
		2 * summary.assistantErrors +
		summary.retries +
		2 * summary.abortedMessages +
		2 * summary.orphanToolCalls +
		(summary.maxToolErrorStreak >= 3 ? summary.maxToolErrorStreak : 0)
	);
}

export function aggregateSummaries(
	summaries: readonly TraceSessionSummary[],
	options: { topErrors?: number; topSessions?: number } = {},
): TraceAggregate {
	const topErrors = options.topErrors ?? 100;
	const topSessions = options.topSessions ?? 20;
	const tokens = emptyTokens();
	const stopReasons: Record<string, number> = {};
	const tools = new Map<string, TraceToolAggregate & { totalMs: number; timed: number }>();
	const errorGroups = new Map<string, TraceErrorGroupAggregate>();
	const models = new Map<string, TraceModelAggregate & { latencyMs: number; latencyCount: number }>();
	const daily = new Map<string, TraceAggregate["daily"][number]>();
	const latencies: number[] = [];
	const slowest: Array<TraceSlowCall & { key: string }> = [];
	let latencyCount = 0;
	let latencyTotal = 0;
	let latencyMax = 0;
	const result = {
		sessionsWithErrors: 0,
		subagentSessions: 0,
		abortedSessions: 0,
		userMessages: 0,
		assistantMessages: 0,
		toolCalls: 0,
		toolErrors: 0,
		assistantErrors: 0,
		abortedMessages: 0,
		orphanToolCalls: 0,
		retries: 0,
		compactions: 0,
		cost: 0,
		durationMs: 0,
	};

	for (const summary of summaries) {
		if (sessionHasErrors(summary)) result.sessionsWithErrors++;
		if (summary.isSubagent) result.subagentSessions++;
		if (summary.abortedMessages > 0 || summary.lastStopReason === "aborted") result.abortedSessions++;
		result.userMessages += summary.userMessages;
		result.assistantMessages += summary.assistantMessages;
		result.toolCalls += summary.toolCalls;
		result.toolErrors += summary.toolErrors;
		result.assistantErrors += summary.assistantErrors;
		result.abortedMessages += summary.abortedMessages;
		result.orphanToolCalls += summary.orphanToolCalls;
		result.retries += summary.retries;
		result.compactions += summary.compactions;
		result.cost += summary.cost;
		result.durationMs += summary.durationMs;
		addTokens(tokens, summary.tokens);
		for (const [reason, count] of Object.entries(summary.stopReasons)) {
			stopReasons[reason] = (stopReasons[reason] ?? 0) + count;
		}
		latencyCount += summary.latency.count;
		latencyTotal += summary.latency.totalMs;
		latencyMax = Math.max(latencyMax, summary.latency.maxMs);
		latencies.push(...summary.latencySamples);

		for (const [name, stat] of Object.entries(summary.tools)) {
			let tool = tools.get(name);
			if (!tool) {
				tool = { name, calls: 0, errors: 0, errorRate: 0, maxMs: 0, sessions: 0, totalMs: 0, timed: 0 };
				tools.set(name, tool);
			}
			tool.calls += stat.calls;
			tool.errors += stat.errors;
			tool.totalMs += stat.totalMs;
			tool.timed += stat.timed;
			tool.maxMs = Math.max(tool.maxMs, stat.maxMs);
			tool.sessions++;
		}

		for (const group of summary.errorGroups) {
			const groupKey = `${group.kind}\u0000${group.tool ?? ""}\u0000${group.signature}`;
			let aggregate = errorGroups.get(groupKey);
			if (!aggregate) {
				aggregate = {
					signature: group.signature,
					kind: group.kind,
					...(group.tool ? { tool: group.tool } : {}),
					count: 0,
					sessions: 0,
					example: group.example,
					examples: [],
				};
				errorGroups.set(groupKey, aggregate);
			}
			aggregate.count += group.count;
			aggregate.sessions++;
			if (aggregate.examples.length < 5) aggregate.examples.push({ key: summary.key, entryId: group.entryId });
		}

		for (const call of summary.slowestToolCalls) slowest.push({ ...call, key: summary.key });

		const modelName = summary.primaryModel ?? "(unknown)";
		let model = models.get(modelName);
		if (!model) {
			model = {
				model: modelName,
				sessions: 0,
				assistantMessages: 0,
				assistantErrors: 0,
				toolCalls: 0,
				toolErrors: 0,
				tokens: 0,
				cost: 0,
				latencyMs: 0,
				latencyCount: 0,
			};
			models.set(modelName, model);
		}
		model.sessions++;
		model.assistantMessages += summary.assistantMessages;
		model.assistantErrors += summary.assistantErrors;
		model.toolCalls += summary.toolCalls;
		model.toolErrors += summary.toolErrors;
		model.tokens += summary.tokens.total;
		model.cost += summary.cost;
		model.latencyMs += summary.latency.totalMs;
		model.latencyCount += summary.latency.count;

		const day = localDay(summary.startedAt);
		let dayStats = daily.get(day);
		if (!dayStats) {
			dayStats = { day, sessions: 0, sessionsWithErrors: 0, toolCalls: 0, toolErrors: 0, cost: 0 };
			daily.set(day, dayStats);
		}
		dayStats.sessions++;
		if (sessionHasErrors(summary)) dayStats.sessionsWithErrors++;
		dayStats.toolCalls += summary.toolCalls;
		dayStats.toolErrors += summary.toolErrors;
		dayStats.cost += summary.cost;
	}

	latencies.sort((a, b) => a - b);
	const count = summaries.length;
	const average = (total: number) => (count > 0 ? total / count : 0);

	return {
		sessions: count,
		sessionsWithErrors: result.sessionsWithErrors,
		subagentSessions: result.subagentSessions,
		abortedSessions: result.abortedSessions,
		userMessages: result.userMessages,
		assistantMessages: result.assistantMessages,
		toolCalls: result.toolCalls,
		toolErrors: result.toolErrors,
		toolErrorRate: result.toolCalls > 0 ? result.toolErrors / result.toolCalls : 0,
		assistantErrors: result.assistantErrors,
		abortedMessages: result.abortedMessages,
		orphanToolCalls: result.orphanToolCalls,
		retries: result.retries,
		compactions: result.compactions,
		tokens,
		cost: result.cost,
		avgUserMessages: average(result.userMessages),
		avgAssistantMessages: average(result.assistantMessages),
		avgToolCalls: average(result.toolCalls),
		avgDurationMs: average(result.durationMs),
		latency: {
			count: latencyCount,
			...(latencyCount > 0 ? { avgMs: latencyTotal / latencyCount } : {}),
			...(latencies.length > 0 ? { p50Ms: percentile(latencies, 0.5), p90Ms: percentile(latencies, 0.9) } : {}),
			maxMs: latencyMax,
		},
		stopReasons,
		tools: [...tools.values()]
			.map(({ totalMs, timed, ...tool }) => ({
				...tool,
				errorRate: tool.calls > 0 ? tool.errors / tool.calls : 0,
				...(timed > 0 ? { avgMs: totalMs / timed } : {}),
			}))
			.sort((a, b) => b.errors - a.errors || b.calls - a.calls || a.name.localeCompare(b.name)),
		errorGroups: [...errorGroups.values()]
			.sort((a, b) => b.count - a.count || b.sessions - a.sessions)
			.slice(0, topErrors),
		models: [...models.values()]
			.map(({ latencyMs, latencyCount: modelLatencyCount, ...model }) => ({
				...model,
				...(modelLatencyCount > 0 ? { avgLatencyMs: latencyMs / modelLatencyCount } : {}),
			}))
			.sort((a, b) => b.sessions - a.sessions),
		struggling: summaries
			.map((summary) => ({ summary, score: struggleScore(summary) }))
			.filter(({ score }) => score > 0)
			.sort((a, b) => b.score - a.score || b.summary.startedAt - a.summary.startedAt)
			.slice(0, topSessions)
			.map(({ summary, score }) => ({
				key: summary.key,
				score,
				cwd: summary.cwd,
				firstMessage: summary.firstMessage,
				...(summary.primaryModel ? { primaryModel: summary.primaryModel } : {}),
				startedAt: summary.startedAt,
				toolErrors: summary.toolErrors,
				assistantErrors: summary.assistantErrors,
				retries: summary.retries,
				maxToolErrorStreak: summary.maxToolErrorStreak,
				abortedMessages: summary.abortedMessages,
				orphanToolCalls: summary.orphanToolCalls,
			})),
		slowestToolCalls: slowest.sort((a, b) => b.ms - a.ms).slice(0, topSessions),
		daily: [...daily.values()].sort((a, b) => b.day.localeCompare(a.day)),
	};
}
