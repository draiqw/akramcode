/**
 * Connects a local `/remote` server to a public relay (see remote-relay.ts). Holds the relay's
 * request stream open, replays each browser request against the local server, and streams the
 * local response back. Reconnects until closed.
 */

import { randomBytes } from "node:crypto";
import type { RelayFrame } from "./remote-relay.ts";

const RECONNECT_DELAY_MS = 2000;
const FORWARDED_RESPONSE_HEADERS = [
	"content-type",
	"cache-control",
	"content-security-policy",
	"x-content-type-options",
	"referrer-policy",
	"cross-origin-resource-policy",
];

export interface RemoteTunnelOptions {
	/** Relay base URL, e.g. `https://remote.example.com`. */
	relayUrl: string;
	relayKey: string;
	/** Port of the local `/remote` server on 127.0.0.1. */
	localPort: number;
}

export interface RemoteTunnel {
	/** Public URL of the session's room, without the access token. */
	readonly url: string;
	close(): void;
}

/** Opens the tunnel; resolves once the relay accepted the first connection, rejects if it did not. */
export async function openRemoteTunnel(options: RemoteTunnelOptions): Promise<RemoteTunnel> {
	const relayUrl = options.relayUrl.replace(/\/+$/, "");
	const room = randomBytes(16).toString("hex");
	const auth = { Authorization: `Bearer ${options.relayKey}` };
	const closed = new AbortController();
	const inFlight = new Map<string, AbortController>();

	const forward = async (frame: Extract<RelayFrame, { type: "request" }>) => {
		const controller = new AbortController();
		inFlight.set(frame.id, controller);
		const signal = AbortSignal.any([controller.signal, closed.signal]);
		try {
			let status: number;
			let headers: Record<string, string> = {};
			let body: ReadableStream<Uint8Array> | string | null;
			try {
				const local = await fetch(`http://127.0.0.1:${options.localPort}${frame.path}`, {
					method: frame.method,
					headers: frame.headers,
					body: frame.body === undefined ? undefined : Buffer.from(frame.body, "base64"),
					signal,
				});
				status = local.status;
				for (const name of FORWARDED_RESPONSE_HEADERS) {
					const value = local.headers.get(name);
					if (value) headers[name] = value;
				}
				body = local.body;
			} catch (error) {
				if (signal.aborted) return;
				status = 502;
				headers = { "content-type": "text/plain; charset=utf-8" };
				body = error instanceof Error ? error.message : String(error);
			}
			await fetch(`${relayUrl}/agent/${room}/reply/${frame.id}`, {
				method: "POST",
				headers: { ...auth, "x-relay-status": String(status), "x-relay-headers": JSON.stringify(headers) },
				body,
				duplex: "half",
				signal,
			});
		} catch {
			// The browser left or the relay dropped the reply; nothing to answer anymore.
		} finally {
			inFlight.delete(frame.id);
		}
	};

	/** Reads one request stream until it ends. Resolves `false` when the relay refused it. */
	const runStream = async (onConnected: () => void): Promise<boolean> => {
		const res = await fetch(`${relayUrl}/agent/${room}`, { headers: auth, signal: closed.signal });
		if (!res.ok || !res.body) {
			await res.body?.cancel();
			throw new Error(`Relay refused the connection: ${res.status} ${await res.text().catch(() => "")}`.trim());
		}
		onConnected();
		const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
		let buffer = "";
		while (true) {
			const { value, done } = await reader.read();
			if (done) return true;
			buffer += value;
			let end = buffer.indexOf("\n\n");
			while (end !== -1) {
				const data = /^data: (.*)$/m.exec(buffer.slice(0, end))?.[1];
				buffer = buffer.slice(end + 2);
				end = buffer.indexOf("\n\n");
				if (!data) continue;
				const frame = JSON.parse(data) as RelayFrame;
				if (frame.type === "cancel") inFlight.get(frame.id)?.abort();
				else void forward(frame);
			}
		}
	};

	// The first connection must succeed so /remote can report a bad URL or key right away.
	await new Promise<void>((resolveFirst, rejectFirst) => {
		let connected = false;
		const loop = async () => {
			while (!closed.signal.aborted) {
				try {
					await runStream(() => {
						connected = true;
						resolveFirst();
					});
				} catch (error) {
					if (!connected) {
						closed.abort();
						rejectFirst(error);
						return;
					}
				}
				for (const controller of inFlight.values()) controller.abort();
				if (closed.signal.aborted) return;
				await new Promise((resolveDelay) => setTimeout(resolveDelay, RECONNECT_DELAY_MS));
			}
		};
		void loop();
	});

	return {
		url: `${relayUrl}/r/${room}/`,
		close: () => closed.abort(),
	};
}
