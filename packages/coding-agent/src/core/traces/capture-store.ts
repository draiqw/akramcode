/**
 * Read-only index of captured traces (`<agentDir>/traces/`) for `akramcode traces`. Capture files
 * are append-only, so a refresh reads only the bytes added since the last read. Large bodies stay
 * in blob files and are read on demand.
 */

import { closeSync, openSync, readSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type {
	BodyRef,
	CaptureRecord,
	HttpRecord,
	ModelRequestRecord,
	ToolExecutionRecord,
	TraceHeaderRecord,
	WebSocketRecord,
} from "./capture/format.ts";
import { traceKeyForPath } from "./store.ts";

const MAX_SCAN_DEPTH = 3;
const READ_CHUNK_BYTES = 4 * 1024 * 1024;

export interface CaptureFileIndex {
	key: string;
	path: string;
	header?: TraceHeaderRecord;
	modelRequests: ModelRequestRecord[];
	http: HttpRecord[];
	websockets: WebSocketRecord[];
	tools: ToolExecutionRecord[];
	malformedLines: number;
}

interface FileState extends CaptureFileIndex {
	size: number;
	mtimeMs: number;
	offset: number;
	remainder: string;
}

/** HTTP or WebSocket activity in list form, for the Network view. */
export interface NetworkListItem {
	kind: "http" | "websocket";
	fileKey: string;
	id: string;
	t: number;
	sessionId?: string;
	modelRequestId?: string;
	pid?: number;
	provider?: string;
	model?: string;
	method: string;
	url: string;
	host: string;
	status?: number;
	error?: string;
	aborted?: boolean;
	durationMs?: number;
	ttfbMs?: number;
	connectMs?: number;
	reusedConnection?: boolean;
	bytesOut: number;
	bytesIn: number;
	remoteAddress?: string;
	remotePort?: number;
	httpVersion?: string;
	tlsProtocol?: string;
	proxy?: string;
	frames?: number;
}

export interface NetworkFilter {
	q?: string;
	host?: string;
	status?: "2xx" | "3xx" | "4xx" | "5xx" | "error" | "none";
	provider?: string;
	sessionId?: string;
	errors?: boolean;
	slowMs?: number;
	from?: number;
	to?: number;
}

function isErrorItem(item: NetworkListItem): boolean {
	return item.error !== undefined || item.aborted === true || (item.status !== undefined && item.status >= 400);
}

export class CaptureStore {
	readonly dir: string;
	private files = new Map<string, FileState>();
	private byKey = new Map<string, FileState>();
	private modelRequestIndex = new Map<string, { file: FileState; record: ModelRequestRecord }>();
	private refreshing: Promise<boolean> | undefined;
	version = 0;

	constructor(dir: string) {
		this.dir = resolve(dir);
	}

	refresh(): Promise<boolean> {
		this.refreshing ??= this.doRefresh().finally(() => {
			this.refreshing = undefined;
		});
		return this.refreshing;
	}

	private async collect(dir: string, depth: number, out: Map<string, { size: number; mtimeMs: number }>) {
		let names: string[];
		try {
			names = await readdir(dir);
		} catch {
			return;
		}
		for (const name of names) {
			const path = join(dir, name);
			if (name.endsWith(".blobs")) continue;
			try {
				const stats = await stat(path);
				if (stats.isFile() && name.endsWith(".jsonl")) out.set(path, { size: stats.size, mtimeMs: stats.mtimeMs });
				else if (stats.isDirectory() && depth < MAX_SCAN_DEPTH) await this.collect(path, depth + 1, out);
			} catch {
				// Removed concurrently.
			}
		}
	}

	private async doRefresh(): Promise<boolean> {
		const found = new Map<string, { size: number; mtimeMs: number }>();
		await this.collect(this.dir, 0, found);
		let changed = false;
		for (const path of this.files.keys()) {
			if (!found.has(path)) {
				this.files.delete(path);
				changed = true;
			}
		}
		for (const [path, stats] of found) {
			let state = this.files.get(path);
			if (state && state.size === stats.size && state.mtimeMs === stats.mtimeMs) continue;
			if (!state || stats.size < state.offset) {
				state = {
					key: traceKeyForPath(path),
					path,
					modelRequests: [],
					http: [],
					websockets: [],
					tools: [],
					malformedLines: 0,
					size: 0,
					mtimeMs: 0,
					offset: 0,
					remainder: "",
				};
				this.files.set(path, state);
			}
			this.readAppended(state, stats.size);
			state.size = stats.size;
			state.mtimeMs = stats.mtimeMs;
			changed = true;
		}
		if (changed || this.version === 0) {
			this.byKey = new Map([...this.files.values()].map((file) => [file.key, file]));
			this.modelRequestIndex = new Map();
			for (const file of this.files.values()) {
				for (const record of file.modelRequests) this.modelRequestIndex.set(record.id, { file, record });
			}
			this.version++;
		}
		return changed;
	}

	private readAppended(state: FileState, size: number): void {
		let fd: number | undefined;
		try {
			fd = openSync(state.path, "r");
			const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, Math.max(1, size - state.offset)));
			while (state.offset < size) {
				const bytesRead = readSync(fd, buffer, 0, Math.min(buffer.length, size - state.offset), state.offset);
				if (bytesRead === 0) break;
				state.offset += bytesRead;
				const text = state.remainder + buffer.subarray(0, bytesRead).toString("utf8");
				const lines = text.split("\n");
				state.remainder = lines.pop() ?? "";
				for (const line of lines) this.addLine(state, line);
			}
		} catch {
			// Unreadable file: keep what was read.
		} finally {
			if (fd !== undefined) closeSync(fd);
		}
	}

	private addLine(state: FileState, line: string): void {
		if (!line.trim()) return;
		let record: CaptureRecord;
		try {
			record = JSON.parse(line) as CaptureRecord;
		} catch {
			state.malformedLines++;
			return;
		}
		switch (record?.type) {
			case "trace_header":
				state.header ??= record;
				break;
			case "model_request":
				state.modelRequests.push(record);
				break;
			case "http":
				state.http.push(record);
				break;
			case "websocket":
				state.websockets.push(record);
				break;
			case "tool_execution":
				state.tools.push(record);
				break;
			default:
				state.malformedLines++;
		}
	}

	getFile(key: string): CaptureFileIndex | undefined {
		return this.byKey.get(key);
	}

	/** Everything captured for one session id, across processes that wrote to it. */
	getSession(sessionId: string): CaptureFileIndex[] {
		return [...this.files.values()]
			.filter((file) => file.header?.scope === "session" && file.header.sessionId === sessionId)
			.sort((a, b) => (a.header?.t ?? 0) - (b.header?.t ?? 0));
	}

	getModelRequest(id: string): { file: CaptureFileIndex; record: ModelRequestRecord } | undefined {
		return this.modelRequestIndex.get(id);
	}

	/** HTTP and WebSocket records of process-level files from `pid` in the time window. */
	getProcessActivity(pids: ReadonlySet<number>, from: number, to: number): NetworkListItem[] {
		const items: NetworkListItem[] = [];
		for (const file of this.files.values()) {
			if (file.header?.scope !== "process" || !pids.has(file.header.pid)) continue;
			for (const item of this.fileItems(file)) if (item.t >= from && item.t <= to) items.push(item);
		}
		return items.sort((a, b) => a.t - b.t);
	}

	private fileItems(file: FileState): NetworkListItem[] {
		const items: NetworkListItem[] = [];
		for (const record of file.http) {
			const model = record.modelRequestId ? this.modelRequestIndex.get(record.modelRequestId)?.record : undefined;
			items.push({
				kind: "http",
				fileKey: file.key,
				id: record.id,
				t: record.t,
				sessionId: record.sessionId,
				modelRequestId: record.modelRequestId,
				pid: file.header?.pid,
				provider: model?.provider,
				model: model?.model,
				method: record.method,
				url: record.url,
				host: record.host,
				status: record.status,
				error: record.error,
				aborted: record.aborted,
				durationMs: record.timing.totalMs,
				ttfbMs: record.timing.ttfbMs,
				connectMs: record.timing.connectMs,
				reusedConnection: record.timing.reusedConnection,
				bytesOut: record.bytesOut,
				bytesIn: record.bytesIn,
				remoteAddress: record.network.remoteAddress,
				remotePort: record.network.remotePort,
				httpVersion: record.network.httpVersion,
				tlsProtocol: record.network.tlsProtocol,
				proxy: record.network.proxy,
			});
		}
		for (const record of file.websockets) {
			const model = record.modelRequestId ? this.modelRequestIndex.get(record.modelRequestId)?.record : undefined;
			items.push({
				kind: "websocket",
				fileKey: file.key,
				id: record.id,
				t: record.t,
				sessionId: record.sessionId,
				modelRequestId: record.modelRequestId,
				pid: file.header?.pid,
				provider: model?.provider,
				model: model?.model,
				method: "WS",
				url: record.url,
				host: record.host,
				status: record.handshake?.status,
				error: record.error,
				durationMs: record.endedAt - record.t,
				bytesOut: record.bytesOut,
				bytesIn: record.bytesIn,
				remoteAddress: record.network?.remoteAddress,
				remotePort: record.network?.remotePort,
				tlsProtocol: record.network?.tlsProtocol,
				proxy: record.network?.proxy,
				frames: record.framesSent + record.framesReceived,
			});
		}
		return items;
	}

	listNetwork(filter: NetworkFilter, limit = 1000): { total: number; items: NetworkListItem[] } {
		const q = filter.q?.toLowerCase();
		const items: NetworkListItem[] = [];
		for (const file of this.files.values()) {
			for (const item of this.fileItems(file)) {
				if (filter.host && item.host !== filter.host) continue;
				if (filter.provider && item.provider !== filter.provider) continue;
				if (filter.sessionId && item.sessionId !== filter.sessionId) continue;
				if (filter.errors && !isErrorItem(item)) continue;
				if (filter.slowMs !== undefined && (item.durationMs ?? 0) < filter.slowMs) continue;
				if (filter.from !== undefined && item.t < filter.from) continue;
				if (filter.to !== undefined && item.t >= filter.to) continue;
				if (filter.status) {
					const status = item.status;
					if (
						filter.status === "error"
							? !isErrorItem(item)
							: filter.status === "none"
								? status !== undefined
								: status === undefined || `${Math.floor(status / 100)}xx` !== filter.status
					)
						continue;
				}
				if (
					q &&
					!`${item.method} ${item.url} ${item.remoteAddress ?? ""} ${item.error ?? ""}`.toLowerCase().includes(q)
				)
					continue;
				items.push(item);
			}
		}
		items.sort((a, b) => b.t - a.t);
		return { total: items.length, items: items.slice(0, limit) };
	}

	networkFacets(): {
		hosts: Array<{ value: string; count: number }>;
		providers: Array<{ value: string; count: number }>;
	} {
		const hosts = new Map<string, number>();
		const providers = new Map<string, number>();
		for (const file of this.files.values()) {
			for (const item of this.fileItems(file)) {
				hosts.set(item.host, (hosts.get(item.host) ?? 0) + 1);
				if (item.provider) providers.set(item.provider, (providers.get(item.provider) ?? 0) + 1);
			}
		}
		const toList = (map: Map<string, number>) =>
			[...map.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
		return { hosts: toList(hosts), providers: toList(providers) };
	}

	/** Text of a body, reading its blob if needed; cut at `maxChars` for display. */
	async readBody(
		fileKey: string,
		ref: BodyRef | undefined,
		maxChars = Number.POSITIVE_INFINITY,
	): Promise<{ text?: string; cut?: number } | undefined> {
		if (!ref) return undefined;
		let text = ref.text;
		if (text === undefined && ref.blob) text = await this.readBlob(fileKey, ref.blob);
		if (text === undefined) return {};
		if (text.length > maxChars) return { text: text.slice(0, maxChars), cut: text.length - maxChars };
		return { text };
	}

	async readBlob(fileKey: string, name: string): Promise<string | undefined> {
		const file = this.byKey.get(fileKey);
		if (!file || !/^[A-Za-z0-9._-]+$/.test(name)) return undefined;
		const blobDir = `${file.path.slice(0, -".jsonl".length)}.blobs`;
		try {
			return await readFile(join(blobDir, basename(name)), "utf8");
		} catch {
			return undefined;
		}
	}
}
