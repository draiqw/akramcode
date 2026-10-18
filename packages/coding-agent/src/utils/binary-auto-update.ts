import type { AppMode } from "../cli/args.ts";
import type { InstallMethod } from "../config.ts";
import {
	applyStagedBinaryRelease,
	assertReleaseInstallDir,
	discardStagedBinaryRelease,
	type StagedBinaryRelease,
	stageBinaryRelease,
} from "./binary-self-update.ts";

export interface BinaryAutoUpdateConditions {
	installMethod: InstallMethod;
	/** The `autoUpdate` setting. */
	autoUpdate: boolean;
	appMode: AppMode;
	/** Directory that holds the running executable and its assets. */
	installDir: string;
	env?: NodeJS.ProcessEnv;
}

/**
 * Whether a newer release may be downloaded in the background and installed on exit: only for the standalone binary
 * in an unpacked, writable release directory, in interactive mode, with `autoUpdate` on and update checks allowed.
 */
export function canAutoUpdateBinary(conditions: BinaryAutoUpdateConditions): boolean {
	const env = conditions.env ?? process.env;
	if (conditions.installMethod !== "bun-binary" || !conditions.autoUpdate || conditions.appMode !== "interactive") {
		return false;
	}
	if (env.AKRAMCODE_OFFLINE || env.AKRAMCODE_SKIP_VERSION_CHECK) {
		return false;
	}
	try {
		assertReleaseInstallDir(conditions.installDir);
		return true;
	} catch {
		return false;
	}
}

/** Result of installing a staged release when the process exits. */
export type BinaryAutoUpdateExitResult = { installed: true; version: string } | { installed: false; error?: string };

/**
 * Install a staged release, unless the installed version is already the same or newer, and remove the staging
 * directory. Synchronous and never throws, so it is safe in a process `exit` handler.
 */
export function installStagedBinaryReleaseOnExit(staged: StagedBinaryRelease): BinaryAutoUpdateExitResult {
	try {
		const installed = applyStagedBinaryRelease(staged, { onlyIfNewer: true });
		return installed ? { installed: true, version: staged.version } : { installed: false };
	} catch (error: unknown) {
		return { installed: false, error: error instanceof Error ? error.message : String(error) };
	} finally {
		try {
			discardStagedBinaryRelease(staged);
		} catch {
			// A leftover staging directory is removed by the next update.
		}
	}
}

export interface StartBinaryAutoUpdateOptions {
	version: string;
	installDir: string;
	/** Called with the installed version or error after the process exit handler ran; output must be synchronous. */
	onExit?: (result: BinaryAutoUpdateExitResult) => void;
}

/**
 * Stage `version` in the background and install it when the process exits. Resolves with the staged release, or
 * rejects when staging fails (including BinaryUpdateLockedError when another process is updating); the install
 * directory is untouched in that case.
 */
export async function startBinaryAutoUpdate(options: StartBinaryAutoUpdateOptions): Promise<StagedBinaryRelease> {
	const staged = await stageBinaryRelease({ version: options.version, installDir: options.installDir });
	// prependListener runs the swap before other exit handlers, such as the lock cleanup of proper-lockfile.
	process.prependOnceListener("exit", () => {
		const result = installStagedBinaryReleaseOnExit(staged);
		options.onExit?.(result);
	});
	return staged;
}
