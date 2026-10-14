/**
 * On-disk format of captured traces. Each process writes append-only JSONL files under
 * `<agentDir>/traces/`: one per session (`sessions/<sessionId>/<start>_<pid>.jsonl`) and one for
 * activity outside any session (`process/<start>_<pid>.jsonl`). Bodies larger than
 * {@link INLINE_BODY_LIMIT} go to `<file>.blobs/<name>`; records reference them by name.
 */

export const CAPTURE_FORMAT_VERSION = 1;
/** Bodies up to this many UTF-8 bytes are stored inline in the JSONL record. */
export const INLINE_BODY_LIMIT = 16 * 1024;
export const CAPTURE_DIR_NAME = "traces";

export interface BodyRef {
	/** Size in UTF-8 bytes of the stored (decoded, redacted) text. */
	bytes: number;
	sha1?: string;
	text?: string;
	/** File name in the `.blobs` directory next to the trace file. */
	blob?: string;
	/** The capture limit cut the body. */
	truncated?: boolean;
	/** Bytes on the wire, when they differ (compressed responses). */
	wireBytes?: number;
	contentEncoding?: string;
	/** Not stored because it equals another body, for example the model request payload. */
	sameAs?: "payload";
	/** Not text; only the size is kept. */
	binary?: boolean;
	/** Why the body is missing or cut, for example the in-flight memory budget or a decompression limit. */
	note?: string;
}

export interface TraceHeaderRecord {
	type: "trace_header";
	version: number;
	t: number;
	pid: number;
	scope: "session" | "process";
	sessionId?: string;
	sessionFile?: string;
	cwd?: string;
	appVersion?: string;
}

export interface ModelRequestRecord {
	type: "model_request";
	id: string;
	t: number;
	sessionId: string;
	provider: string;
	api: string;
	model: string;
	payload?: BodyRef;
	payloadAt?: number;
	response?: { status: number; headers: Record<string, string | string[]>; t: number };
	events?: BodyRef;
	eventCount: number;
	firstEventAt?: number;
	endedAt: number;
	durationMs: number;
	ttfbMs?: number;
	stopReason?: string;
	errorMessage?: string;
	usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: number };
	responseId?: string;
	responseModel?: string;
	/** Timestamp of the assistant message; links to the session entry with the same message timestamp. */
	messageTimestamp?: number;
	message?: BodyRef;
}

export interface HttpTiming {
	/** Time to connect a new socket (DNS, TCP, and TLS together). Absent for a reused connection. */
	connectMs?: number;
	reusedConnection?: boolean;
	/** From request start until headers were written (queueing and connecting included). */
	sendMs?: number;
	/** Until response headers. */
	ttfbMs?: number;
	totalMs?: number;
}

export interface NetworkInfo {
	remoteAddress?: string;
	remotePort?: number;
	localAddress?: string;
	localPort?: number;
	remoteFamily?: string;
	httpVersion?: string;
	tlsProtocol?: string;
	alpnProtocol?: string;
	cipher?: string;
	servername?: string;
	proxy?: string;
	/** Connect time of a WebSocket's handshake connection. */
	connectMs?: number;
}

export interface HttpRecord {
	type: "http";
	id: string;
	t: number;
	sessionId?: string;
	modelRequestId?: string;
	method: string;
	url: string;
	host: string;
	requestHeaders: Record<string, string | string[]>;
	requestBody?: BodyRef;
	status?: number;
	statusText?: string;
	responseHeaders?: Record<string, string | string[]>;
	responseBody?: BodyRef;
	timing: HttpTiming;
	network: NetworkInfo;
	bytesOut: number;
	bytesIn: number;
	error?: string;
	aborted?: boolean;
}

export interface WebSocketRecord {
	type: "websocket";
	id: string;
	t: number;
	sessionId?: string;
	modelRequestId?: string;
	url: string;
	host: string;
	handshake?: {
		status?: number;
		requestHeaders?: Record<string, string | string[]>;
		headers?: Record<string, string | string[]>;
		protocol?: string;
		extensions?: string;
	};
	network?: NetworkInfo;
	/** JSONL of `{ t, data }` frames. */
	sent?: BodyRef;
	received?: BodyRef;
	framesSent: number;
	framesReceived: number;
	bytesOut: number;
	bytesIn: number;
	endedAt: number;
	closeCode?: number;
	error?: string;
}

export interface ToolExecutionRecord {
	type: "tool_execution";
	id: string;
	t: number;
	sessionId: string;
	toolCallId: string;
	toolName: string;
	cwd?: string;
	args?: BodyRef;
	/** Text content of the tool result: what the model received. */
	content?: BodyRef;
	images?: number;
	details?: BodyRef;
	/** The complete output when the tool saved it to a file because it was truncated for the model. */
	fullOutput?: BodyRef;
	fullOutputPath?: string;
	exitCode?: number;
	isError: boolean;
	endedAt: number;
	durationMs: number;
}

export type CaptureRecord = TraceHeaderRecord | ModelRequestRecord | HttpRecord | WebSocketRecord | ToolExecutionRecord;
