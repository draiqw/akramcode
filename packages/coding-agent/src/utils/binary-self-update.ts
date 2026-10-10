import { createHash } from "node:crypto";
import {
	accessSync,
	constants,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { APP_NAME, PACKAGE_NAME, VERSION } from "../config.ts";
import { getAkramCodeUserAgent } from "./akramcode-user-agent.ts";
import { spawnProcessSync } from "./child-process.ts";
import { fetchWithRetry } from "./management-http.ts";
import { comparePackageVersions } from "./version-check.ts";

const RELEASE_DOWNLOAD_BASE_URL = "https://github.com/draiqw/akramcode/releases/download";
const RELEASES_PAGE_URL = "https://github.com/draiqw/akramcode/releases/latest";
export const BINARY_INSTALLER_COMMAND =
	"curl -fsSL https://github.com/draiqw/akramcode/releases/latest/download/install.sh | sh";
const RELEASE_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DOWNLOAD_TIMEOUT_MS = 300_000;

export interface BinarySelfUpdateOptions {
	version: string;
	/** Directory that holds the running executable and its assets, e.g. ~/.akramcode/bin-release. */
	installDir: string;
	platform?: NodeJS.Platform;
	arch?: string;
	/** Override for tests; release assets live under `<base>/v<version>/`. */
	releaseBaseUrl?: string;
}

/** A verified release unpacked next to the install directory, waiting to replace it. */
export interface StagedBinaryRelease {
	version: string;
	installDir: string;
	/** Temporary directory owned by this process; removed by discardStagedBinaryRelease. */
	stageDir: string;
	/** The unpacked release inside stageDir. */
	releaseDir: string;
}

/** Thrown when another akramcode process is staging or installing an update for the same install directory. */
export class BinaryUpdateLockedError extends Error {
	constructor(installDir: string) {
		super(`Another ${APP_NAME} update is already running for ${installDir}.`);
		this.name = "BinaryUpdateLockedError";
	}
}

/** Release archive name for a platform, or undefined when no standalone build is published for it. */
export function getBinaryReleaseAssetName(platform: NodeJS.Platform, arch: string): string | undefined {
	const os = platform === "darwin" || platform === "linux" ? platform : undefined;
	const cpu = arch === "arm64" || arch === "x64" ? arch : undefined;
	return os && cpu ? `${APP_NAME}-${os}-${cpu}.tar.gz` : undefined;
}

/** Expected sha256 for a file from a `sha256sum`/`shasum` listing. */
export function findSha256(sums: string, fileName: string): string | undefined {
	for (const line of sums.split("\n")) {
		const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
		if (match && match[2] === fileName) return match[1].toLowerCase();
	}
	return undefined;
}

async function download(url: string): Promise<Response> {
	const response = await fetchWithRetry(
		url,
		{ headers: { "User-Agent": getAkramCodeUserAgent(VERSION) } },
		{ timeoutMs: DOWNLOAD_TIMEOUT_MS },
	);
	if (!response.ok) {
		throw new Error(`Could not download ${url}: HTTP ${response.status}`);
	}
	return response;
}

function readInstalledVersion(installDir: string): { name: unknown; version: unknown } | undefined {
	try {
		const pkg = JSON.parse(readFileSync(join(installDir, "package.json"), "utf8")) as {
			name?: unknown;
			version?: unknown;
		};
		return { name: pkg.name, version: pkg.version };
	} catch {
		return undefined;
	}
}

/** Throws unless installDir is a writable, unpacked release directory that can be replaced as a whole. */
export function assertReleaseInstallDir(installDir: string): void {
	// The whole directory is replaced, so make sure it is a release directory and not, say, ~/bin.
	if (readInstalledVersion(installDir)?.name !== PACKAGE_NAME || !existsSync(join(installDir, "theme"))) {
		throw new Error(
			`${installDir} does not look like an unpacked ${APP_NAME} release. Reinstall with: ${BINARY_INSTALLER_COMMAND}`,
		);
	}
	try {
		accessSync(installDir, constants.W_OK);
		accessSync(dirname(installDir), constants.W_OK);
	} catch {
		throw new Error(
			`Cannot update ${APP_NAME} in ${installDir}: the directory or its parent is not writable. Rerun the installer as the owner of that directory: ${BINARY_INSTALLER_COMMAND}`,
		);
	}
}

function verifyStagedRelease(stagedDir: string, version: string): void {
	const binPath = join(stagedDir, APP_NAME);
	try {
		accessSync(binPath, constants.X_OK);
	} catch {
		throw new Error(`The downloaded archive does not contain an executable ${APP_NAME}/${APP_NAME}.`);
	}
	const result = spawnProcessSync(binPath, ["--version"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.error || result.status !== 0) {
		const reason = result.error?.message || result.stderr.trim() || `exit code ${result.status ?? "unknown"}`;
		throw new Error(`Could not run the downloaded ${APP_NAME} ${version}: ${reason}`);
	}
	const reportedVersion = result.stdout.trim();
	if (reportedVersion !== version) {
		throw new Error(`The downloaded ${APP_NAME} reports version ${reportedVersion}; expected ${version}.`);
	}
}

/** Lock shared by staging and installing, kept next to the install directory because the directory itself is swapped. */
function getUpdateLockPath(installDir: string): string {
	return join(dirname(installDir), `.${basename(installDir)}.update.lock`);
}

function isUpdateLockedError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ELOCKED";
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error: unknown) {
		// EPERM: the process exists but belongs to another user.
		return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
	}
}

/**
 * Remove staging and backup directories left by akramcode processes that are no longer running (for example after a
 * crash between download and exit). Directories of running processes are kept: they may still install their update.
 */
function cleanupStaleUpdateDirs(installDir: string): void {
	const parentDir = dirname(installDir);
	const pattern = new RegExp(
		`^\\.${basename(installDir).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(?:update|previous)-(\\d+)-`,
	);
	let entries: string[];
	try {
		entries = readdirSync(parentDir);
	} catch {
		return;
	}
	for (const entry of entries) {
		const match = pattern.exec(entry);
		if (!match || isProcessAlive(Number(match[1]))) continue;
		// A backup is only stale while the install directory exists; otherwise it is the last working copy.
		if (entry.includes("-previous-") && !existsSync(installDir)) continue;
		rmSync(join(parentDir, entry), { force: true, recursive: true });
	}
}

/**
 * Download the release for `version`, verify its checksum, unpack it next to the install directory, and check that
 * the new binary runs and reports `version`. The install directory is not touched. Throws BinaryUpdateLockedError
 * when another process is staging or installing an update for the same directory.
 */
export async function stageBinaryRelease(options: BinarySelfUpdateOptions): Promise<StagedBinaryRelease> {
	const { version, installDir } = options;
	if (!RELEASE_VERSION_RE.test(version)) {
		throw new Error(`Invalid release version: ${version}`);
	}
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	const assetName = getBinaryReleaseAssetName(platform, arch);
	if (!assetName) {
		throw new Error(`No standalone ${APP_NAME} build is published for ${platform}-${arch}. See ${RELEASES_PAGE_URL}`);
	}
	assertReleaseInstallDir(installDir);

	let releaseLock: () => Promise<void>;
	try {
		releaseLock = await lockfile.lock(installDir, {
			realpath: false,
			lockfilePath: getUpdateLockPath(installDir),
			// A lost lock only means another process may stage too; installing takes the lock again.
			onCompromised: () => {},
		});
	} catch (error: unknown) {
		if (isUpdateLockedError(error)) throw new BinaryUpdateLockedError(installDir);
		throw error;
	}

	let stageDir: string | undefined;
	try {
		cleanupStaleUpdateDirs(installDir);
		const releaseUrl = `${(options.releaseBaseUrl ?? RELEASE_DOWNLOAD_BASE_URL).replace(/\/+$/, "")}/v${version}`;
		const [archiveResponse, sumsResponse] = await Promise.all([
			download(`${releaseUrl}/${assetName}`),
			download(`${releaseUrl}/SHA256SUMS`),
		]);
		const archive = Buffer.from(await archiveResponse.arrayBuffer());
		const expectedSha = findSha256(await sumsResponse.text(), assetName);
		if (!expectedSha) {
			throw new Error(`${assetName} is missing from SHA256SUMS of release v${version}.`);
		}
		const actualSha = createHash("sha256").update(archive).digest("hex");
		if (actualSha !== expectedSha) {
			throw new Error(`Checksum mismatch for ${assetName}: expected ${expectedSha}, got ${actualSha}.`);
		}

		// The pid in the name lets cleanupStaleUpdateDirs tell abandoned staging directories from live ones.
		stageDir = mkdtempSync(join(dirname(installDir), `.${basename(installDir)}-update-${process.pid}-`));
		const archivePath = join(stageDir, assetName);
		writeFileSync(archivePath, archive);
		const tar = spawnProcessSync("tar", ["-xzf", archivePath, "-C", stageDir], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		if (tar.error || tar.status !== 0) {
			const reason = tar.error?.message || tar.stderr.trim() || `exit code ${tar.status ?? "unknown"}`;
			throw new Error(`Could not unpack ${assetName}: ${reason}`);
		}
		rmSync(archivePath, { force: true });
		const releaseDir = join(stageDir, APP_NAME);
		verifyStagedRelease(releaseDir, version);
		return { version, installDir, stageDir, releaseDir };
	} catch (error: unknown) {
		if (stageDir) rmSync(stageDir, { force: true, recursive: true });
		throw error;
	} finally {
		await releaseLock();
	}
}

/**
 * Replace the install directory with a staged release. Synchronous so it can run from a process `exit` handler.
 * With `onlyIfNewer`, nothing is installed when the installed version is already the staged version or newer (for
 * example because another process installed an update in the meantime). Returns whether the release was installed.
 * The old directory is restored if the swap fails. The staging directory is left for discardStagedBinaryRelease.
 */
export function applyStagedBinaryRelease(staged: StagedBinaryRelease, options?: { onlyIfNewer?: boolean }): boolean {
	const { installDir, releaseDir, version } = staged;
	let releaseLock: () => void;
	try {
		releaseLock = lockfile.lockSync(installDir, {
			realpath: false,
			lockfilePath: getUpdateLockPath(installDir),
			onCompromised: () => {},
		});
	} catch (error: unknown) {
		if (isUpdateLockedError(error)) throw new BinaryUpdateLockedError(installDir);
		throw error;
	}

	try {
		if (!existsSync(releaseDir)) {
			throw new Error(`The staged ${APP_NAME} ${version} is missing: ${releaseDir}`);
		}
		assertReleaseInstallDir(installDir);
		if (options?.onlyIfNewer) {
			const installedVersion = readInstalledVersion(installDir)?.version;
			const comparison =
				typeof installedVersion === "string" ? comparePackageVersions(version, installedVersion) : undefined;
			if (comparison === undefined || comparison <= 0) return false;
		}

		const parentDir = dirname(installDir);
		const backupDir = join(parentDir, `.${basename(installDir)}-previous-${process.pid}-${Date.now()}`);
		renameSync(installDir, backupDir);
		try {
			renameSync(releaseDir, installDir);
		} catch (error: unknown) {
			renameSync(backupDir, installDir);
			throw error;
		}
		rmSync(backupDir, { force: true, recursive: true });
		return true;
	} finally {
		releaseLock();
	}
}

/** Remove the staging directory of a release that was installed or will not be installed. */
export function discardStagedBinaryRelease(staged: StagedBinaryRelease): void {
	rmSync(staged.stageDir, { force: true, recursive: true });
}

/**
 * Replace a standalone binary installation with the GitHub release for `version`: stage the verified release, then
 * swap the directories. The old directory is restored if the swap fails.
 */
export async function runBinarySelfUpdate(options: BinarySelfUpdateOptions): Promise<void> {
	const staged = await stageBinaryRelease(options);
	try {
		applyStagedBinaryRelease(staged);
	} finally {
		discardStagedBinaryRelease(staged);
	}
}
