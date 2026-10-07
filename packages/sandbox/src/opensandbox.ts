import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import {
	ConnectionConfig,
	Sandbox,
	type SandboxCreateOptions,
	type SandboxInfo,
	SandboxManager,
} from "@alibaba-group/opensandbox";
import { createSandboxBashOperations, type SessionHost } from "./exec.ts";
import { createSandboxFileOperations } from "./files.ts";
import { FileLeaseStore } from "./lease.ts";
import type { ResolvedOpenSandboxSettings, ResolvedSandboxSettings } from "./settings.ts";
import type { SandboxAcquireRequest, SandboxProvider, SandboxRuntime, SandboxWorkspace } from "./types.ts";
import { createVolumeClient, sweepVolumes, type VolumeClient, VolumeLedger } from "./volumes.ts";

const META_CONV = "akc-conv-id";
const META_OWNER = "akc-owner-id";
const META_WORKSPACE = "akc-workspace";
const META_CWD = "akc-cwd";
const META_REUSE = "akc-reuse";
const READY_TIMEOUT_SECONDS = 120;
const SWEEP_INTERVAL_MS = 86_400_000;

/** The calls the provider needs from the OpenSandbox SDK; tests replace it. */
export interface OpenSandboxApi {
	create(options: SandboxCreateOptions): Promise<Sandbox>;
	connect(sandboxId: string): Promise<Sandbox>;
	resume(sandboxId: string): Promise<Sandbox>;
	list(metadata: Record<string, string>): Promise<SandboxInfo[]>;
	kill(sandboxId: string): Promise<void>;
}

export function createOpenSandboxApi(settings: ResolvedOpenSandboxSettings): OpenSandboxApi {
	const connectionConfig = new ConnectionConfig({
		domain: settings.domain,
		protocol: settings.protocol,
		apiKey: settings.apiKey,
		useServerProxy: settings.useServerProxy,
	});
	const manager = SandboxManager.create({ connectionConfig });
	return {
		create: (options) => Sandbox.create({ ...options, connectionConfig }),
		connect: (sandboxId) => Sandbox.connect({ connectionConfig, sandboxId }),
		resume: (sandboxId) => Sandbox.resume({ connectionConfig, sandboxId }),
		async list(metadata) {
			const response = await manager.listSandboxInfos({ states: ["Running", "Paused"], metadata, pageSize: 100 });
			return response.items;
		},
		kill: (sandboxId) => manager.killSandbox(sandboxId),
	};
}

export interface OpenSandboxProviderOptions {
	settings: ResolvedSandboxSettings;
	/** Directory for leases and the volume ledger. */
	dataDir: string;
	ownerId?: string;
	api?: OpenSandboxApi;
	volumes?: VolumeClient;
	now?: () => number;
}

/** Metadata values are limited to 63 characters of [A-Za-z0-9-_.], so the folder is stored as a hash. */
function cwdKey(cwd: string): string {
	return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

/** Docker-safe fragment of a name. */
function slug(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "x"
	);
}

/** The configured sandbox could not be started; callers show the message instead of a stack trace. */
export class SandboxUnavailableError extends Error {
	override readonly name = "SandboxUnavailableError";
	constructor(message: string, cause: unknown) {
		super(message, { cause });
	}
}

export class OpenSandboxProvider implements SandboxProvider {
	readonly name = "opensandbox";
	private readonly config: ResolvedOpenSandboxSettings;
	private readonly workspace: SandboxWorkspace;
	private readonly api: OpenSandboxApi;
	private readonly volumes: VolumeClient;
	private readonly leases: FileLeaseStore;
	private readonly ledger: VolumeLedger;
	private readonly ownerId: string;
	private readonly now: () => number;
	private readonly dataDir: string;

	constructor(options: OpenSandboxProviderOptions) {
		this.config = options.settings.opensandbox;
		this.workspace = options.settings.workspace;
		this.api = options.api ?? createOpenSandboxApi(this.config);
		this.volumes = options.volumes ?? createVolumeClient(this.config);
		this.dataDir = options.dataDir;
		this.leases = new FileLeaseStore(join(options.dataDir, "leases"));
		this.ledger = new VolumeLedger(join(options.dataDir, "volumes.json"));
		this.ownerId = slug(options.ownerId ?? userInfo().username).slice(0, 32);
		this.now = options.now ?? Date.now;
	}

	volumeName(sessionId: string): string {
		return `${this.config.volumePrefix}${this.ownerId}-${slug(sessionId)}`;
	}

	async acquire(request: SandboxAcquireRequest): Promise<SandboxRuntime> {
		const leased = this.leases.tryAcquire(request.sessionId);
		const volumeName = this.workspace === "volume" ? this.volumeName(request.sessionId) : undefined;
		if (volumeName) this.ledger.touch(volumeName, this.now());

		let sandbox: Sandbox | undefined;
		try {
			if (leased) sandbox = await this.attach(request);
			sandbox ??= await this.create(request, volumeName, leased);
		} catch (error) {
			await this.discardFailed(request, leased);
			const reason = error instanceof Error ? error.message : String(error);
			throw new SandboxUnavailableError(`OpenSandbox is unavailable at ${this.config.domain}: ${reason}`, error);
		}

		const host: SessionHost = { sandbox, cwd: request.cwd };
		const files = this.workspace === "volume" ? createSandboxFileOperations(host) : undefined;
		const runtime: SandboxRuntime = {
			provider: this.name,
			sandboxId: sandbox.id,
			workspace: this.workspace,
			bash: createSandboxBashOperations(host),
			...(files ? { files } : {}),
			release: async () => {
				await this.release(host, request, leased);
			},
		};
		void this.background(request.sessionId);
		return runtime;
	}

	/** A create that timed out leaves a half-started sandbox on the server: delete it and free the lease. */
	private async discardFailed(request: SandboxAcquireRequest, leased: boolean): Promise<void> {
		try {
			const orphans = await this.api.list({ [META_CONV]: request.sessionId, [META_OWNER]: this.ownerId });
			for (const info of orphans) await this.api.kill(info.id).catch(() => undefined);
		} catch {
			// The server may be unreachable; nothing more to clean up from here.
		}
		if (leased) this.leases.release(request.sessionId);
	}

	/** A live sandbox of this session with the same mounts, or undefined. Stale ones are deleted. */
	private async attach(request: SandboxAcquireRequest): Promise<Sandbox | undefined> {
		const found = await this.api.list({ [META_CONV]: request.sessionId, [META_OWNER]: this.ownerId });
		const candidates = found.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
		let attached: Sandbox | undefined;
		for (const info of candidates) {
			const meta = info.metadata ?? {};
			const compatible =
				meta[META_WORKSPACE] === this.workspace &&
				meta[META_CWD] === cwdKey(request.cwd) &&
				meta[META_REUSE] === "1";
			if (attached || !compatible) {
				await this.api.kill(info.id).catch(() => undefined);
				continue;
			}
			try {
				let sandbox = await this.api.connect(info.id);
				if (info.status.state === "Paused") sandbox = await this.api.resume(info.id);
				await sandbox.renew(this.config.ttlMinutes * 60);
				await this.probeWritable(sandbox, request.cwd);
				attached = sandbox;
			} catch {
				await this.api.kill(info.id).catch(() => undefined);
			}
		}
		return attached;
	}

	private async probeWritable(sandbox: Sandbox, cwd: string): Promise<void> {
		const session = await sandbox.commands.createSession({ workingDirectory: cwd });
		try {
			const result = await sandbox.commands.runInSession(session, `test -w ${JSON.stringify(cwd)}`);
			if (result.exitCode !== 0) throw new Error("Sandbox workspace is not writable");
		} finally {
			await sandbox.commands.deleteSession(session).catch(() => undefined);
		}
	}

	private async create(
		request: SandboxAcquireRequest,
		volumeName: string | undefined,
		reusable: boolean,
	): Promise<Sandbox> {
		const mount =
			volumeName === undefined
				? { name: "akc-workspace", host: { path: request.cwd }, mountPath: request.cwd }
				: {
						name: volumeName,
						pvc: { claimName: volumeName, createIfNotExists: true, deleteOnSandboxTermination: false },
						mountPath: request.cwd,
					};
		return this.api.create({
			image: this.config.image,
			timeoutSeconds: this.config.ttlMinutes * 60,
			readyTimeoutSeconds: READY_TIMEOUT_SECONDS,
			resource: { cpu: this.config.cpu, memory: this.config.memory },
			volumes: [mount],
			...(this.config.network === "deny" ? { networkPolicy: { defaultAction: "deny" as const } } : {}),
			metadata: {
				[META_CONV]: request.sessionId,
				[META_OWNER]: this.ownerId,
				[META_WORKSPACE]: this.workspace,
				[META_CWD]: cwdKey(request.cwd),
				[META_REUSE]: reusable ? "1" : "0",
			},
		});
	}

	private async release(host: SessionHost, request: SandboxAcquireRequest, leased: boolean): Promise<void> {
		const sandbox = host.sandbox;
		try {
			await host.closeSession?.();
			if (leased) {
				await sandbox.renew(this.config.idleMinutes * 60);
				await this.evict(request.sessionId);
			} else {
				await sandbox.kill();
			}
		} finally {
			await sandbox.close().catch(() => undefined);
			if (leased) this.leases.release(request.sessionId);
		}
	}

	/** Keep at most `maxLive` reusable sandboxes: delete the ones released longest ago. */
	private async evict(currentSessionId: string): Promise<void> {
		const live = (await this.api.list({ [META_OWNER]: this.ownerId })).filter(
			(info) => info.metadata?.[META_REUSE] === "1",
		);
		const excess = live.length - this.config.maxLive;
		if (excess <= 0) return;
		const victims = live
			.filter((info) => info.metadata?.[META_CONV] !== currentSessionId)
			.sort((a, b) => (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0))
			.slice(0, excess);
		for (const info of victims) await this.api.kill(info.id).catch(() => undefined);
	}

	/** Daily sweep of stale workspace volumes; never blocks or fails a session. */
	private async background(_sessionId: string): Promise<void> {
		if (this.workspace !== "volume") return;
		try {
			const stamp = join(this.dataDir, "last-sweep");
			const last = (() => {
				try {
					return Number(readFileSync(stamp, "utf-8"));
				} catch {
					return 0;
				}
			})();
			if (this.now() - last < SWEEP_INTERVAL_MS) return;
			mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
			writeFileSync(stamp, String(this.now()));
			await sweepVolumes(this.ledger, this.volumes, this.config.volumeRetentionDays, this.now());
		} catch {
			// The sweep is best effort.
		}
	}
}

export function defaultSandboxDataDir(): string {
	return join(homedir(), ".akramcode", "agent", "sandbox");
}
