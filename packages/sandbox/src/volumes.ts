import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ResolvedOpenSandboxSettings } from "./settings.ts";

/**
 * Volumes are listed and deleted through the `/v1/volumes` endpoints of the aiva OpenSandbox fork;
 * upstream OpenSandbox has no such endpoints and its server answers 404.
 */
export interface VolumeClient {
	remove(name: string): Promise<"deleted" | "in-use" | "missing" | "forbidden">;
}

export function createVolumeClient(
	settings: ResolvedOpenSandboxSettings,
	fetchImpl: typeof fetch = fetch,
): VolumeClient {
	return {
		async remove(name) {
			const response = await fetchImpl(
				`${settings.protocol}://${settings.domain}/v1/volumes/${encodeURIComponent(name)}`,
				{ method: "DELETE", headers: settings.apiKey ? { "OPEN-SANDBOX-API-KEY": settings.apiKey } : {} },
			);
			if (response.ok) return "deleted";
			if (response.status === 409) return "in-use";
			if (response.status === 404) return "missing";
			if (response.status === 403) return "forbidden";
			throw new Error(`Deleting volume ${name} failed with HTTP ${response.status}`);
		},
	};
}

type Touches = Record<string, number>;

/** When each workspace volume was last used, kept on disk because the server does not report it. */
export class VolumeLedger {
	private readonly file: string;

	constructor(file: string) {
		this.file = file;
	}

	private read(): Touches {
		try {
			const parsed: unknown = JSON.parse(readFileSync(this.file, "utf-8"));
			return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Touches) : {};
		} catch {
			return {};
		}
	}

	private write(touches: Touches): void {
		mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
		writeFileSync(this.file, JSON.stringify(touches, null, 2), { mode: 0o600 });
	}

	touch(name: string, now: number): void {
		const touches = this.read();
		touches[name] = now;
		this.write(touches);
	}

	/** Names of volumes untouched since `cutoff`. */
	stale(cutoff: number): string[] {
		return Object.entries(this.read())
			.filter(([, touched]) => touched < cutoff)
			.map(([name]) => name);
	}

	forget(name: string): void {
		const touches = this.read();
		delete touches[name];
		this.write(touches);
	}
}

export interface SweepResult {
	deleted: string[];
	skipped: string[];
}

/** Delete volumes untouched for `retentionDays`. A volume still mounted by a live sandbox is kept. */
export async function sweepVolumes(
	ledger: VolumeLedger,
	client: VolumeClient,
	retentionDays: number,
	now: number,
): Promise<SweepResult> {
	const result: SweepResult = { deleted: [], skipped: [] };
	for (const name of ledger.stale(now - retentionDays * 86_400_000)) {
		const outcome = await client.remove(name);
		if (outcome === "deleted" || outcome === "missing") {
			ledger.forget(name);
			result.deleted.push(name);
		} else {
			result.skipped.push(name);
		}
	}
	return result;
}
