import { fauxAssistantMessage } from "@akramcode/providers";
import { afterEach, describe, expect, it } from "vitest";
import { getRemoteUiDir } from "../../src/config.ts";
import {
	type RemoteControlServer,
	type RemoteEvent,
	startRemoteControl,
} from "../../src/modes/interactive/remote-control.ts";
import { type RelayServer, startRelayServer } from "../../src/modes/interactive/remote-relay.ts";
import { openRemoteTunnel, type RemoteTunnel } from "../../src/modes/interactive/remote-tunnel.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("/remote server", () => {
	const harnesses: Harness[] = [];
	const servers: RemoteControlServer[] = [];
	const relays: RelayServer[] = [];
	const tunnels: RemoteTunnel[] = [];

	afterEach(async () => {
		while (tunnels.length > 0) tunnels.pop()?.close();
		while (relays.length > 0) await relays.pop()?.close();
		while (servers.length > 0) await servers.pop()?.close();
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function start(): Promise<{
		harness: Harness;
		server: RemoteControlServer;
		base: string;
		auth: Record<string, string>;
	}> {
		const harness = await createHarness();
		harnesses.push(harness);
		const server = await startRemoteControl({
			uiDir: getRemoteUiDir(),
			hostname: "127.0.0.1",
			host: { session: () => harness.session, submit: (text) => harness.session.prompt(text) },
		});
		servers.push(server);
		return {
			harness,
			server,
			base: `http://127.0.0.1:${server.port}`,
			auth: { Authorization: `Bearer ${server.token}` },
		};
	}

	/** Collect server-sent events until `done` returns true. */
	async function collectEvents(
		base: string,
		auth: Record<string, string>,
		done: (events: RemoteEvent[]) => boolean,
		onOpen: () => Promise<void>,
	): Promise<RemoteEvent[]> {
		const res = await fetch(`${base}/api/events`, { headers: auth });
		const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
		const events: RemoteEvent[] = [];
		await onOpen();
		let buffer = "";
		while (!done(events)) {
			const { value, done: ended } = await reader.read();
			if (ended) break;
			buffer += value;
			for (const match of buffer.matchAll(/^data: (.*)$/gm)) events.push(JSON.parse(match[1]!) as RemoteEvent);
			buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
		}
		await reader.cancel();
		return events;
	}

	it("serves the page without a token and rejects API calls without one", async () => {
		const { base, server } = await start();

		const page = await fetch(`${base}/`);
		expect(page.status).toBe(200);
		expect(await page.text()).toContain("akramcode remote");
		expect((await fetch(`${base}/api/state`)).status).toBe(401);
		expect((await fetch(`${base}/api/state`, { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
		expect(server.urls[0]).toMatch(/^http:\/\/[\d.]+:\d+\/#token=[0-9a-f]{64}$/);
	});

	it("runs prompts from the browser and streams the transcript", async () => {
		const { harness, base, auth } = await start();
		harness.setResponses([fauxAssistantMessage("hello from the agent")]);

		const events = await collectEvents(
			base,
			auth,
			(seen) => seen.some((event) => event.type === "status" && !event.busy),
			async () => {
				const res = await fetch(`${base}/api/prompt`, {
					method: "POST",
					headers: { ...auth, "Content-Type": "application/json" },
					body: JSON.stringify({ text: "hi" }),
				});
				expect(res.status).toBe(200);
			},
		);

		const messages = events.flatMap((event) => (event.type === "message" ? [event.message] : []));
		expect(messages).toEqual([
			{ role: "user", text: "hi" },
			{ role: "assistant", text: "hello from the agent", thinking: "", tools: [] },
		]);

		const state = (await (await fetch(`${base}/api/state`, { headers: auth })).json()) as {
			busy: boolean;
			messages: unknown[];
		};
		expect(state.busy).toBe(false);
		expect(state.messages).toEqual(messages);
	});

	it("rejects an empty prompt", async () => {
		const { base, auth } = await start();
		const res = await fetch(`${base}/api/prompt`, {
			method: "POST",
			headers: { ...auth, "Content-Type": "application/json" },
			body: JSON.stringify({ text: "  " }),
		});
		expect(res.status).toBe(400);
	});

	it("tells browsers to reload when the session changes", async () => {
		const { base, auth, server } = await start();
		const events = await collectEvents(
			base,
			auth,
			(seen) => seen.length > 0,
			async () => server.sessionChanged(),
		);
		expect(events).toEqual([{ type: "reset" }]);
	});

	describe("through a relay", () => {
		async function startWithRelay() {
			const local = await start();
			const relay = await startRelayServer({ key: "relay-key", hostname: "127.0.0.1" });
			relays.push(relay);
			const tunnel = await openRemoteTunnel({
				relayUrl: `http://127.0.0.1:${relay.port}/`,
				relayKey: "relay-key",
				localPort: local.server.port,
			});
			tunnels.push(tunnel);
			return { ...local, relay, tunnel, base: tunnel.url.slice(0, -1) };
		}

		it("serves the page and the token-checked API under the room path", async () => {
			const { base, auth, tunnel } = await startWithRelay();
			expect(tunnel.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/r\/[0-9a-f]{32}\/$/);

			const page = await fetch(`${base}/`);
			expect(page.status).toBe(200);
			expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
			expect(await page.text()).toContain("akramcode remote");
			expect((await fetch(`${base}/api/state`)).status).toBe(401);
			expect((await fetch(`${base}/api/state`, { headers: auth })).status).toBe(200);
			const redirect = await fetch(base, { redirect: "manual" });
			expect(redirect.status).toBe(308);
			expect(redirect.headers.get("location")).toBe(new URL(tunnel.url).pathname);
		});

		it("runs prompts and streams the transcript", async () => {
			const { harness, base, auth } = await startWithRelay();
			harness.setResponses([fauxAssistantMessage("relayed answer")]);

			const events = await collectEvents(
				base,
				auth,
				(seen) => seen.some((event) => event.type === "status" && !event.busy),
				async () => {
					const res = await fetch(`${base}/api/prompt`, {
						method: "POST",
						headers: { ...auth, "Content-Type": "application/json" },
						body: JSON.stringify({ text: "hi via relay" }),
					});
					expect(res.status).toBe(200);
				},
			);
			expect(events.flatMap((event) => (event.type === "message" ? [event.message] : []))).toEqual([
				{ role: "user", text: "hi via relay" },
				{ role: "assistant", text: "relayed answer", thinking: "", tools: [] },
			]);
		});

		it("rejects a wrong relay key and reports offline rooms", async () => {
			const { server } = await start();
			const relay = await startRelayServer({ key: "relay-key", hostname: "127.0.0.1" });
			relays.push(relay);
			await expect(
				openRemoteTunnel({ relayUrl: `http://127.0.0.1:${relay.port}`, relayKey: "wrong", localPort: server.port }),
			).rejects.toThrow(/401/);
			const offline = await fetch(`http://127.0.0.1:${relay.port}/r/${"0".repeat(32)}/`);
			expect(offline.status).toBe(503);
		});

		it("keeps the link working after the tunnel reconnects", async () => {
			const { base, auth, relay } = await startWithRelay();
			relay.server.closeAllConnections();
			let status = 0;
			for (let attempt = 0; attempt < 50 && status !== 200; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				status = (await fetch(`${base}/api/state`, { headers: auth })).status;
			}
			expect(status).toBe(200);
		});
	});
});
