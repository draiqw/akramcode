import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxInfo } from "@alibaba-group/opensandbox";
import { describe, expect, it } from "vitest";
import { type OpenSandboxApi, OpenSandboxProvider } from "../src/opensandbox.ts";
import { resolveSandboxSettings } from "../src/settings.ts";

interface FakeBox {
	id: string;
	metadata: Record<string, string>;
	state: "Running" | "Paused";
	createdAt: number;
	expiresAt: number;
	renewed: number[];
	killed: boolean;
	writable: boolean;
	runs: string[];
}

function createFake() {
	const boxes = new Map<string, FakeBox>();
	const created: Array<Record<string, unknown>> = [];
	let counter = 0;
	const asSandbox = (box: FakeBox): Sandbox =>
		({
			id: box.id,
			renew: async (seconds: number) => {
				box.renewed.push(seconds);
			},
			kill: async () => {
				box.killed = true;
				boxes.delete(box.id);
			},
			close: async () => undefined,
			commands: {
				createSession: async () => "session-1",
				deleteSession: async () => undefined,
				interrupt: async () => undefined,
				runInSession: async (_id: string, command: string) => {
					box.runs.push(command);
					return { exitCode: command.startsWith("test -w") && !box.writable ? 1 : 0 };
				},
			},
			files: {},
		}) as unknown as Sandbox;
	const api: OpenSandboxApi = {
		async create(options) {
			counter++;
			created.push(options as unknown as Record<string, unknown>);
			const box: FakeBox = {
				id: `box-${counter}`,
				metadata: { ...(options.metadata ?? {}) },
				state: "Running",
				createdAt: counter,
				expiresAt: counter,
				renewed: [],
				killed: false,
				writable: true,
				runs: [],
			};
			boxes.set(box.id, box);
			return asSandbox(box);
		},
		async connect(id) {
			return asSandbox(boxes.get(id)!);
		},
		async resume(id) {
			boxes.get(id)!.state = "Running";
			return asSandbox(boxes.get(id)!);
		},
		async list(metadata) {
			return [...boxes.values()]
				.filter((box) => Object.entries(metadata).every(([key, value]) => box.metadata[key] === value))
				.map(
					(box) =>
						({
							id: box.id,
							metadata: box.metadata,
							status: { state: box.state },
							createdAt: new Date(box.createdAt),
							expiresAt: new Date(box.expiresAt),
						}) as unknown as SandboxInfo,
				);
		},
		async kill(id) {
			boxes.delete(id);
		},
	};
	return { api, boxes, created };
}

function makeProvider(
	fake: ReturnType<typeof createFake>,
	overrides: Record<string, unknown> = {},
	workspace: "mount" | "volume" = "mount",
) {
	return new OpenSandboxProvider({
		settings: resolveSandboxSettings({
			provider: "opensandbox",
			workspace,
			opensandbox: { maxLive: 2, ...overrides },
		}),
		dataDir: mkdtempSync(join(tmpdir(), "akc-provider-")),
		ownerId: "me",
		api: fake.api,
		volumes: { remove: async () => "deleted" },
	});
}

describe("OpenSandboxProvider", () => {
	it("deletes a half-started sandbox and reports a readable error when the sandbox never becomes ready", async () => {
		const fake = createFake();
		const create = fake.api.create;
		fake.api.create = async (options) => {
			await create(options);
			throw new Error("health check timed out");
		};
		const provider = makeProvider(fake);
		await expect(provider.acquire({ sessionId: "s1", cwd: "/work/proj" })).rejects.toThrow(
			/OpenSandbox is unavailable at 127\.0\.0\.1:8080: health check timed out/,
		);
		expect(fake.boxes.size).toBe(0);
	});

	it("mounts the host folder at the same path in mount mode and keeps file tools on the host", async () => {
		const fake = createFake();
		const runtime = await makeProvider(fake).acquire({ sessionId: "s1", cwd: "/work/proj" });
		expect(runtime.files).toBeUndefined();
		expect(runtime.workspace).toBe("mount");
		expect(fake.created[0]?.volumes).toEqual([
			{ name: "akc-workspace", host: { path: "/work/proj" }, mountPath: "/work/proj" },
		]);
		await runtime.release();
	});

	it("uses a named volume per session in volume mode", async () => {
		const fake = createFake();
		const provider = makeProvider(fake, {}, "volume");
		const runtime = await provider.acquire({ sessionId: "Sess 1", cwd: "/work/proj" });
		expect(runtime.files).toBeDefined();
		expect(provider.volumeName("Sess 1")).toBe("akc-me-sess-1");
		expect(fake.created[0]?.volumes).toEqual([
			{
				name: "akc-me-sess-1",
				pvc: { claimName: "akc-me-sess-1", createIfNotExists: true, deleteOnSandboxTermination: false },
				mountPath: "/work/proj",
			},
		]);
		await runtime.release();
	});

	it("reuses the released sandbox of the session instead of creating another", async () => {
		const fake = createFake();
		const provider = makeProvider(fake);
		const first = await provider.acquire({ sessionId: "s1", cwd: "/p" });
		await first.release();
		const second = await provider.acquire({ sessionId: "s1", cwd: "/p" });
		expect(second.sandboxId).toBe(first.sandboxId);
		expect(fake.created).toHaveLength(1);
		expect(fake.boxes.get(first.sandboxId)?.renewed).toContain(20 * 60);
		await second.release();
	});

	it("replaces a sandbox mounted for another folder", async () => {
		const fake = createFake();
		const provider = makeProvider(fake);
		const first = await provider.acquire({ sessionId: "s1", cwd: "/p" });
		await first.release();
		const second = await provider.acquire({ sessionId: "s1", cwd: "/other" });
		expect(second.sandboxId).not.toBe(first.sandboxId);
		expect(fake.boxes.has(first.sandboxId)).toBe(false);
		await second.release();
	});

	it("drops a sandbox whose workspace is not writable", async () => {
		const fake = createFake();
		const provider = makeProvider(fake);
		const first = await provider.acquire({ sessionId: "s1", cwd: "/p" });
		await first.release();
		fake.boxes.get(first.sandboxId)!.writable = false;
		const second = await provider.acquire({ sessionId: "s1", cwd: "/p" });
		expect(second.sandboxId).not.toBe(first.sandboxId);
		await second.release();
	});

	it("resumes a paused sandbox", async () => {
		const fake = createFake();
		const provider = makeProvider(fake);
		const first = await provider.acquire({ sessionId: "s1", cwd: "/p" });
		await first.release();
		fake.boxes.get(first.sandboxId)!.state = "Paused";
		const second = await provider.acquire({ sessionId: "s1", cwd: "/p" });
		expect(second.sandboxId).toBe(first.sandboxId);
		expect(fake.boxes.get(first.sandboxId)?.state).toBe("Running");
		await second.release();
	});

	it("gives a session another live process holds a throwaway sandbox that is deleted on release", async () => {
		const fake = createFake();
		const provider = makeProvider(fake);
		const leases = join((provider as unknown as { dataDir: string }).dataDir, "leases");
		mkdirSync(leases, { recursive: true });
		writeFileSync(join(leases, "s1.lease"), String(process.ppid));
		const runtime = await provider.acquire({ sessionId: "s1", cwd: "/p" });
		expect((fake.created[0]?.metadata as Record<string, string>)["akc-reuse"]).toBe("0");
		await runtime.release();
		expect(fake.boxes.has(runtime.sandboxId)).toBe(false);
	});

	it("keeps at most maxLive reusable sandboxes, dropping the least recently released", async () => {
		const fake = createFake();
		const provider = makeProvider(fake);
		for (const id of ["a", "b", "c"]) {
			const runtime = await provider.acquire({ sessionId: id, cwd: "/p" });
			fake.boxes.get(runtime.sandboxId)!.expiresAt = ["a", "b", "c"].indexOf(id) + 10;
			await runtime.release();
		}
		expect([...fake.boxes.values()].map((box) => box.metadata["akc-conv-id"]).sort()).toEqual(["b", "c"]);
	});

	it("denies outbound traffic when the network setting says so", async () => {
		const fake = createFake();
		const runtime = await makeProvider(fake, { network: "deny" }).acquire({ sessionId: "s1", cwd: "/p" });
		expect(fake.created[0]?.networkPolicy).toEqual({ defaultAction: "deny" });
		await runtime.release();
	});
});
