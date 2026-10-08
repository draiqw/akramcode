/**
 * JSON views over captured traces for the traces server: per-session capture summaries, request
 * details with bodies, and the difference between consecutive model requests of a session.
 */

import type {
	BodyRef,
	HttpRecord,
	ModelRequestRecord,
	ToolExecutionRecord,
	WebSocketRecord,
} from "./capture/format.ts";
import type { CaptureFileIndex, CaptureStore, NetworkListItem } from "./capture-store.ts";

/** Longest body text returned for display; the blob endpoint serves the full text. */
const DISPLAY_BODY_CHARS = 2_000_000;
const MAX_PARSED_PAYLOAD_CHARS = 16_000_000;
const MAX_STREAM_EVENTS = 5000;
const MAX_DIFF_ITEMS = 100;
const DIFF_VALUE_CHARS = 4000;

export interface ModelRequestListItem {
	fileKey: string;
	id: string;
	t: number;
	provider: string;
	api: string;
	model: string;
	durationMs: number;
	ttfbMs?: number;
	status?: number;
	stopReason?: string;
	errorMessage?: string;
	messageTimestamp?: number;
	responseId?: string;
	payloadBytes?: number;
	usage?: ModelRequestRecord["usage"];
	eventCount: number;
	http: number;
	httpErrors: number;
	websockets: number;
	retries: number;
}

export interface ToolListItem {
	fileKey: string;
	id: string;
	toolCallId: string;
	toolName: string;
	t: number;
	durationMs: number;
	exitCode?: number;
	isError: boolean;
	contentBytes?: number;
	fullOutputBytes?: number;
	fullOutputTruncated?: boolean;
	cwd?: string;
}

export interface SessionCapture {
	files: Array<{ key: string; pid: number; t: number }>;
	modelRequests: ModelRequestListItem[];
	tools: ToolListItem[];
	/** Requests of the same processes outside model requests (MCP, web fetch, OAuth, model lists). */
	otherActivity: NetworkListItem[];
}

function isHttpError(record: HttpRecord): boolean {
	return record.error !== undefined || (record.status !== undefined && record.status >= 400);
}

export function sessionCapture(
	capture: CaptureStore,
	sessionId: string,
	window: { from: number; to: number },
): SessionCapture {
	const files = capture.getSession(sessionId);
	const modelRequests: ModelRequestListItem[] = [];
	const tools: ToolListItem[] = [];
	const pids = new Set<number>();
	let lastEnd = window.to;
	for (const file of files) {
		if (file.header) pids.add(file.header.pid);
		const httpByRequest = new Map<string, HttpRecord[]>();
		for (const record of file.http) {
			if (!record.modelRequestId) continue;
			const list = httpByRequest.get(record.modelRequestId) ?? [];
			list.push(record);
			httpByRequest.set(record.modelRequestId, list);
		}
		const wsByRequest = new Map<string, number>();
		for (const record of file.websockets) {
			if (record.modelRequestId)
				wsByRequest.set(record.modelRequestId, (wsByRequest.get(record.modelRequestId) ?? 0) + 1);
		}
		for (const record of file.modelRequests) {
			const http = httpByRequest.get(record.id) ?? [];
			lastEnd = Math.max(lastEnd, record.endedAt);
			modelRequests.push({
				fileKey: file.key,
				id: record.id,
				t: record.t,
				provider: record.provider,
				api: record.api,
				model: record.model,
				durationMs: record.durationMs,
				...(record.ttfbMs !== undefined ? { ttfbMs: record.ttfbMs } : {}),
				...(record.response ? { status: record.response.status } : {}),
				...(record.stopReason ? { stopReason: record.stopReason } : {}),
				...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
				...(record.messageTimestamp !== undefined ? { messageTimestamp: record.messageTimestamp } : {}),
				...(record.responseId ? { responseId: record.responseId } : {}),
				...(record.payload ? { payloadBytes: record.payload.bytes } : {}),
				...(record.usage ? { usage: record.usage } : {}),
				eventCount: record.eventCount,
				http: http.length,
				httpErrors: http.filter(isHttpError).length,
				websockets: wsByRequest.get(record.id) ?? 0,
				// Provider-level retries show as several HTTP requests for one model request.
				retries: Math.max(0, http.length - 1),
			});
		}
		for (const record of file.tools) {
			lastEnd = Math.max(lastEnd, record.endedAt);
			tools.push({
				fileKey: file.key,
				id: record.id,
				toolCallId: record.toolCallId,
				toolName: record.toolName,
				t: record.t,
				durationMs: record.durationMs,
				...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
				isError: record.isError,
				...(record.content ? { contentBytes: record.content.bytes } : {}),
				...(record.fullOutput
					? { fullOutputBytes: record.fullOutput.bytes, fullOutputTruncated: record.fullOutput.truncated }
					: {}),
				...(record.cwd ? { cwd: record.cwd } : {}),
			});
		}
	}
	modelRequests.sort((a, b) => a.t - b.t);
	tools.sort((a, b) => a.t - b.t);
	return {
		files: files.map((file) => ({ key: file.key, pid: file.header?.pid ?? 0, t: file.header?.t ?? 0 })),
		modelRequests,
		tools,
		otherActivity: capture.getProcessActivity(pids, window.from - 1000, lastEnd + 1000),
	};
}

async function bodyView(capture: CaptureStore, fileKey: string, ref: BodyRef | undefined) {
	if (!ref) return undefined;
	const body = await capture.readBody(fileKey, ref, DISPLAY_BODY_CHARS);
	return {
		bytes: ref.bytes,
		...(ref.wireBytes !== undefined ? { wireBytes: ref.wireBytes } : {}),
		...(ref.contentEncoding ? { contentEncoding: ref.contentEncoding } : {}),
		...(ref.truncated ? { truncated: true } : {}),
		...(ref.binary ? { binary: true } : {}),
		...(ref.sameAs ? { sameAs: ref.sameAs } : {}),
		...(ref.note ? { note: ref.note } : {}),
		...(ref.blob ? { blob: ref.blob } : {}),
		...(body?.text !== undefined ? { text: body.text } : {}),
		...(body?.cut ? { cut: body.cut } : {}),
	};
}

function parseJson(text: string | undefined): unknown {
	if (text === undefined || text.length > MAX_PARSED_PAYLOAD_CHARS) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function parseJsonLines(text: string | undefined, max: number): { items: unknown[]; total: number } {
	if (!text) return { items: [], total: 0 };
	const lines = text.split("\n").filter((line) => line.trim());
	const items: unknown[] = [];
	for (const line of lines.slice(0, max)) {
		try {
			items.push(JSON.parse(line));
		} catch {
			items.push({ raw: line });
		}
	}
	return { items, total: lines.length };
}

function cutJson(value: unknown): string {
	const text = JSON.stringify(value, null, 2) ?? "undefined";
	return text.length > DIFF_VALUE_CHARS ? `${text.slice(0, DIFF_VALUE_CHARS)}…` : text;
}

export interface PayloadDiffEntry {
	key: string;
	kind: "array" | "value" | "added" | "removed";
	previousLength?: number;
	length?: number;
	commonPrefix?: number;
	added?: unknown[];
	addedOmitted?: number;
	removed?: number;
	before?: string;
	after?: string;
}

/**
 * What changed between two request payloads. Arrays (messages, input, tools) report the common
 * prefix and the items after it, so the diff shows what was appended to the context; other
 * top-level fields report before and after values.
 */
export function diffPayloads(
	previous: unknown,
	current: unknown,
): { changed: PayloadDiffEntry[]; unchanged: string[] } {
	const changed: PayloadDiffEntry[] = [];
	const unchanged: string[] = [];
	if (!previous || !current || typeof previous !== "object" || typeof current !== "object") {
		return { changed, unchanged };
	}
	const before = previous as Record<string, unknown>;
	const after = current as Record<string, unknown>;
	for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
		const a = before[key];
		const b = after[key];
		if (!(key in after)) {
			changed.push({ key, kind: "removed", before: cutJson(a) });
			continue;
		}
		if (!(key in before)) {
			changed.push({ key, kind: "added", after: cutJson(b) });
			continue;
		}
		if (Array.isArray(a) && Array.isArray(b)) {
			let prefix = 0;
			while (prefix < a.length && prefix < b.length && JSON.stringify(a[prefix]) === JSON.stringify(b[prefix]))
				prefix++;
			if (prefix === a.length && prefix === b.length) {
				unchanged.push(key);
				continue;
			}
			const added = b.slice(prefix);
			changed.push({
				key,
				kind: "array",
				previousLength: a.length,
				length: b.length,
				commonPrefix: prefix,
				added: added.slice(0, MAX_DIFF_ITEMS),
				...(added.length > MAX_DIFF_ITEMS ? { addedOmitted: added.length - MAX_DIFF_ITEMS } : {}),
				removed: a.length - prefix,
			});
			continue;
		}
		if (JSON.stringify(a) === JSON.stringify(b)) unchanged.push(key);
		else changed.push({ key, kind: "value", before: cutJson(a), after: cutJson(b) });
	}
	return { changed, unchanged };
}

async function httpView(capture: CaptureStore, fileKey: string, record: HttpRecord) {
	return {
		...record,
		fileKey,
		requestBody: await bodyView(capture, fileKey, record.requestBody),
		responseBody: await bodyView(capture, fileKey, record.responseBody),
	};
}

async function webSocketView(capture: CaptureStore, fileKey: string, record: WebSocketRecord) {
	const sent = await capture.readBody(fileKey, record.sent, DISPLAY_BODY_CHARS);
	const received = await capture.readBody(fileKey, record.received, DISPLAY_BODY_CHARS);
	return {
		...record,
		fileKey,
		sentFrames: parseJsonLines(sent?.text, MAX_STREAM_EVENTS),
		receivedFrames: parseJsonLines(received?.text, MAX_STREAM_EVENTS),
	};
}

async function payloadOf(capture: CaptureStore, file: CaptureFileIndex, record: ModelRequestRecord) {
	const body = await capture.readBody(file.key, record.payload, MAX_PARSED_PAYLOAD_CHARS);
	return parseJson(body?.text);
}

export async function modelRequestDetail(capture: CaptureStore, id: string) {
	const found = capture.getModelRequest(id);
	if (!found) return undefined;
	const { file, record } = found;
	const payloadText = await capture.readBody(file.key, record.payload, MAX_PARSED_PAYLOAD_CHARS);
	const payload = parseJson(payloadText?.text);
	const events = await capture.readBody(file.key, record.events, DISPLAY_BODY_CHARS);
	const message = await capture.readBody(file.key, record.message, DISPLAY_BODY_CHARS);

	// The previous request of the same session, across the capture files of the session.
	let previous: { file: CaptureFileIndex; record: ModelRequestRecord } | undefined;
	for (const sessionFile of capture.getSession(record.sessionId)) {
		for (const candidate of sessionFile.modelRequests) {
			if (candidate.t < record.t && (!previous || candidate.t > previous.record.t)) {
				previous = { file: sessionFile, record: candidate };
			}
		}
	}
	const previousPayload = previous ? await payloadOf(capture, previous.file, previous.record) : undefined;

	const http = await Promise.all(
		file.http.filter((item) => item.modelRequestId === id).map((item) => httpView(capture, file.key, item)),
	);
	const websockets = await Promise.all(
		file.websockets
			.filter((item) => item.modelRequestId === id)
			.map((item) => webSocketView(capture, file.key, item)),
	);
	return {
		fileKey: file.key,
		record,
		payload: {
			bytes: record.payload?.bytes,
			...(record.payload?.blob ? { blob: record.payload.blob } : {}),
			...(payload !== undefined
				? { json: payload }
				: payloadText?.text !== undefined
					? { text: payloadText.text.slice(0, DISPLAY_BODY_CHARS) }
					: {}),
		},
		events: parseJsonLines(events?.text, MAX_STREAM_EVENTS),
		...(record.events?.blob ? { eventsBlob: record.events.blob } : {}),
		message: parseJson(message?.text),
		http,
		websockets,
		previous: previous
			? {
					id: previous.record.id,
					t: previous.record.t,
					diff: diffPayloads(previousPayload, payload),
				}
			: undefined,
	};
}

export async function httpDetail(capture: CaptureStore, fileKey: string, id: string) {
	const file = capture.getFile(fileKey);
	const record = file?.http.find((item) => item.id === id);
	return file && record ? httpView(capture, fileKey, record) : undefined;
}

export async function webSocketDetail(capture: CaptureStore, fileKey: string, id: string) {
	const file = capture.getFile(fileKey);
	const record = file?.websockets.find((item) => item.id === id);
	return file && record ? webSocketView(capture, fileKey, record) : undefined;
}

export async function toolDetail(capture: CaptureStore, fileKey: string, id: string) {
	const file = capture.getFile(fileKey);
	const record: ToolExecutionRecord | undefined = file?.tools.find((item) => item.id === id);
	if (!file || !record) return undefined;
	return {
		...record,
		fileKey,
		args: await bodyView(capture, fileKey, record.args),
		content: await bodyView(capture, fileKey, record.content),
		details: await bodyView(capture, fileKey, record.details),
		fullOutput: await bodyView(capture, fileKey, record.fullOutput),
	};
}
