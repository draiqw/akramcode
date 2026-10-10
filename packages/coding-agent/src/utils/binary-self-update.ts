import { createHash } from "node:crypto";
import {
	accessSync,
	constants,
	existsSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { APP_NAME, PACKAGE_NAME, VERSION } from "../config.ts";
import { getAkramCodeUserAgent } from "./akramcode-user-agent.ts";
import { spawnProcessSync } from "./child-process.ts";
import { fetchWithRetry } from "./management-http.ts";

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

function assertReleaseInstallDir(installDir: string): void {
	// The whole directory is replaced, so make sure it is a release directory and not, say, ~/bin.
	let packageName: unknown;
	try {
		packageName = (JSON.parse(readFileSync(join(installDir, "package.json"), "utf8")) as { name?: unknown }).name;
	} catch {
		packageName = undefined;
	}
	if (packageName !== PACKAGE_NAME || !existsSync(join(installDir, "theme"))) {
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

/**
 * Replace a standalone binary installation with the GitHub release for `version`.
 *
 * Downloads the platform archive and SHA256SUMS, verifies the checksum, unpacks
 * next to the install directory, smoke-tests the new binary, then swaps the
 * directories. The old directory is restored if the swap fails.
 */
export async function runBinarySelfUpdate(options: BinarySelfUpdateOptions): Promise<void> {
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

	const parentDir = dirname(installDir);
	const stageDir = mkdtempSync(join(parentDir, `.${basename(installDir)}-update-`));
	const backupDir = join(parentDir, `.${basename(installDir)}-previous-${process.pid}-${Date.now()}`);
	try {
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
		const stagedRelease = join(stageDir, APP_NAME);
		verifyStagedRelease(stagedRelease, version);

		renameSync(installDir, backupDir);
		try {
			renameSync(stagedRelease, installDir);
		} catch (error: unknown) {
			renameSync(backupDir, installDir);
			throw error;
		}
		rmSync(backupDir, { force: true, recursive: true });
	} finally {
		rmSync(stageDir, { force: true, recursive: true });
	}
}
