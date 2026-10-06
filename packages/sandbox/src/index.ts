export { createSandboxBashOperations, type SessionHost } from "./exec.ts";
export { createSandboxFileOperations } from "./files.ts";
export { globToRegExp, matchesGlob } from "./glob.ts";
export { FileLeaseStore } from "./lease.ts";
export {
	createOpenSandboxApi,
	defaultSandboxDataDir,
	type OpenSandboxApi,
	OpenSandboxProvider,
	type OpenSandboxProviderOptions,
} from "./opensandbox.ts";
export {
	type OpenSandboxSettings,
	type ResolvedOpenSandboxSettings,
	type ResolvedSandboxSettings,
	resolveSandboxSettings,
	type SandboxProviderName,
	type SandboxSettings,
} from "./settings.ts";
export { shellQuote, withForwardedEnv } from "./shell.ts";
export type {
	SandboxAcquireRequest,
	SandboxBashOperations,
	SandboxFileOperations,
	SandboxProvider,
	SandboxRuntime,
	SandboxWorkspace,
} from "./types.ts";
export { createVolumeClient, type SweepResult, sweepVolumes, type VolumeClient, VolumeLedger } from "./volumes.ts";

import { defaultSandboxDataDir, OpenSandboxProvider } from "./opensandbox.ts";
import { resolveSandboxSettings, type SandboxSettings } from "./settings.ts";
import type { SandboxProvider } from "./types.ts";

export interface CreateSandboxProviderOptions {
	dataDir?: string;
	ownerId?: string;
}

/** The provider for the settings, or undefined when tools run locally on this machine. */
export function createSandboxProvider(
	settings: SandboxSettings | undefined,
	options: CreateSandboxProviderOptions = {},
): SandboxProvider | undefined {
	const resolved = resolveSandboxSettings(settings);
	if (resolved.provider === "local") return undefined;
	return new OpenSandboxProvider({
		settings: resolved,
		dataDir: options.dataDir ?? defaultSandboxDataDir(),
		ownerId: options.ownerId,
	});
}
