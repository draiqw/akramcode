import type { SandboxWorkspace } from "./types.ts";

export type SandboxProviderName = "local" | "opensandbox";

/** Raw `sandbox` settings block as stored in settings.json. */
export interface SandboxSettings {
	provider?: SandboxProviderName;
	workspace?: SandboxWorkspace;
	opensandbox?: OpenSandboxSettings;
}

export interface OpenSandboxSettings {
	/** Server address, `host:port`. */
	domain?: string;
	protocol?: "http" | "https";
	apiKey?: string;
	image?: string;
	cpu?: string;
	memory?: string;
	/** Lifetime of a sandbox the session holds. Must exceed the longest run. */
	ttlMinutes?: number;
	/** How long a released sandbox stays alive for reuse. */
	idleMinutes?: number;
	/** Most live reusable sandboxes; the least recently released ones are deleted beyond it. */
	maxLive?: number;
	/** Name prefix of the volumes this client owns; the server's `managed_volume_prefixes` must include it. */
	volumePrefix?: string;
	/** Volumes untouched for this many days are deleted by the sweep. */
	volumeRetentionDays?: number;
	/** Network access of the sandbox: `deny` blocks all outbound traffic. */
	network?: "allow" | "deny";
}

export interface ResolvedOpenSandboxSettings {
	domain: string;
	protocol: "http" | "https";
	apiKey: string | undefined;
	image: string;
	cpu: string;
	memory: string;
	ttlMinutes: number;
	idleMinutes: number;
	maxLive: number;
	volumePrefix: string;
	volumeRetentionDays: number;
	network: "allow" | "deny";
}

export interface ResolvedSandboxSettings {
	provider: SandboxProviderName;
	workspace: SandboxWorkspace;
	opensandbox: ResolvedOpenSandboxSettings;
}

function positive(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function text(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

export function resolveSandboxSettings(raw: SandboxSettings | undefined): ResolvedSandboxSettings {
	const os = raw?.opensandbox ?? {};
	return {
		provider: raw?.provider === "opensandbox" ? "opensandbox" : "local",
		workspace: raw?.workspace === "volume" ? "volume" : "mount",
		opensandbox: {
			domain: text(os.domain, "127.0.0.1:8080"),
			protocol: os.protocol === "https" ? "https" : "http",
			apiKey: typeof os.apiKey === "string" && os.apiKey !== "" ? os.apiKey : undefined,
			image: text(os.image, "python:3.12-slim"),
			cpu: text(os.cpu, "2"),
			memory: text(os.memory, "4Gi"),
			ttlMinutes: positive(os.ttlMinutes, 330),
			idleMinutes: positive(os.idleMinutes, 20),
			maxLive: Math.floor(positive(os.maxLive, 12)),
			volumePrefix: text(os.volumePrefix, "akc-"),
			volumeRetentionDays: positive(os.volumeRetentionDays, 30),
			network: os.network === "deny" ? "deny" : "allow",
		},
	};
}
