import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PACKAGE_NAME } from "../src/config.ts";
import { canAutoUpdateBinary, installStagedBinaryReleaseOnExit } from "../src/utils/binary-auto-update.ts";
import {
	applyStagedBinaryRelease,
	BinaryUpdateLockedError,
	discardStagedBinaryRelease,
	stageBinaryRelease,
} from "../src/utils/binary-self-update.ts";

const BASE_URL = "https://downloads.example.test/releases";
const ASSET = "akramcode-linux-x64.tar.gz";

let root: string;

function writeRelease(dir: string, version: string): void {
	mkdirSync(join(dir, "theme"), { recursive: true });
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: PACKAGE_NAME, version }));
	writeFileSync(join(dir, "akramcode"), `#!/bin/sh\necho ${version}\n`);
	chmodSync(join(dir, "akramcode"), 0o755);
}

function buildArchive(version: string): Buffer {
	const buildDir = mkdtempSync(join(root, "build-"));
	writeRelease(join(buildDir, "akramcode"), version);
	const archivePath = join(buildDir, ASSET);
	const tar = spawnSync("tar", ["-czf", archivePath, "-C", buildDir, "akramcode"]);
	expect(tar.status).toBe(0);
	return readFileSync(archivePath);
}

function stubReleaseFetch(version: string, archive: Buffer): void {
	const sha = createHash("sha256").update(archive).digest("hex");
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url === `${BASE_URL}/v${version}/${ASSET}`) return new Response(new Uint8Array(archive));
			if (url === `${BASE_URL}/v${version}/SHA256SUMS`) return new Response(`${sha}  ${ASSET}\n`);
			return new Response("not found", { status: 404 });
		}),
	);
}

function stage(installDir: string, version: string) {
	return stageBinaryRelease({ version, installDir, platform: "linux", arch: "x64", releaseBaseUrl: BASE_URL });
}

function updateEntries(): string[] {
	return readdirSync(root).filter((entry) => entry.startsWith(".bin-release"));
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "akramcode-auto-update-"));
});

afterEach(() => {
	vi.unstubAllGlobals();
	rmSync(root, { force: true, recursive: true });
});

describe("staging and installing a binary release", () => {
	it("stages without touching the install directory, then installs on apply", async () => {
		const installDir = join(root, "bin-release");
		writeRelease(installDir, "1.0.0");
		stubReleaseFetch("1.2.0", buildArchive("1.2.0"));

		const staged = await stage(installDir, "1.2.0");
		expect(readFileSync(join(installDir, "akramcode"), "utf8")).toContain("echo 1.0.0");
		expect(existsSync(join(staged.releaseDir, "akramcode"))).toBe(true);

		expect(installStagedBinaryReleaseOnExit(staged)).toEqual({ installed: true, version: "1.2.0" });
		expect(readFileSync(join(installDir, "akramcode"), "utf8")).toContain("echo 1.2.0");
		expect(updateEntries()).toEqual([]);
	});

	it("does not downgrade when a newer version was installed in the meantime", async () => {
		const installDir = join(root, "bin-release");
		writeRelease(installDir, "1.0.0");
		stubReleaseFetch("1.2.0", buildArchive("1.2.0"));
		const staged = await stage(installDir, "1.2.0");

		// Another process installed 1.3.0 before this one exited.
		rmSync(installDir, { recursive: true });
		writeRelease(installDir, "1.3.0");

		expect(installStagedBinaryReleaseOnExit(staged)).toEqual({ installed: false });
		expect(readFileSync(join(installDir, "akramcode"), "utf8")).toContain("echo 1.3.0");
		expect(updateEntries()).toEqual([]);
	});

	it("reports a missing staged release instead of throwing", async () => {
		const installDir = join(root, "bin-release");
		writeRelease(installDir, "1.0.0");
		stubReleaseFetch("1.2.0", buildArchive("1.2.0"));
		const staged = await stage(installDir, "1.2.0");
		discardStagedBinaryRelease(staged);

		const result = installStagedBinaryReleaseOnExit(staged);
		expect(result.installed).toBe(false);
		expect(result.installed === false && result.error).toMatch(/staged akramcode 1\.2\.0 is missing/);
		expect(readFileSync(join(installDir, "akramcode"), "utf8")).toContain("echo 1.0.0");
	});

	it("refuses to install while another process holds the update lock", async () => {
		const installDir = join(root, "bin-release");
		writeRelease(installDir, "1.0.0");
		stubReleaseFetch("1.2.0", buildArchive("1.2.0"));
		const staged = await stage(installDir, "1.2.0");

		mkdirSync(join(root, ".bin-release.update.lock"));
		expect(() => applyStagedBinaryRelease(staged)).toThrow(BinaryUpdateLockedError);
		await expect(stage(installDir, "1.2.0")).rejects.toThrow(BinaryUpdateLockedError);
		rmSync(join(root, ".bin-release.update.lock"), { recursive: true });

		expect(readFileSync(join(installDir, "akramcode"), "utf8")).toContain("echo 1.0.0");
		discardStagedBinaryRelease(staged);
	});

	it("removes staging directories of processes that are no longer running", async () => {
		const installDir = join(root, "bin-release");
		writeRelease(installDir, "1.0.0");
		// No process has pid 2^22 + 1 (above the Linux and macOS pid limits).
		const deadPid = 4194305;
		mkdirSync(join(root, `.bin-release-update-${deadPid}-abc123`));
		mkdirSync(join(root, `.bin-release-previous-${deadPid}-1700000000000`));
		const liveStageDir = join(root, `.bin-release-update-${process.pid}-live01`);
		mkdirSync(liveStageDir);
		stubReleaseFetch("1.2.0", buildArchive("1.2.0"));

		const staged = await stage(installDir, "1.2.0");
		expect(existsSync(join(root, `.bin-release-update-${deadPid}-abc123`))).toBe(false);
		expect(existsSync(join(root, `.bin-release-previous-${deadPid}-1700000000000`))).toBe(false);
		expect(existsSync(liveStageDir)).toBe(true);
		discardStagedBinaryRelease(staged);
	});
});

describe("auto-update conditions", () => {
	function conditions(overrides: Partial<Parameters<typeof canAutoUpdateBinary>[0]> = {}) {
		const installDir = join(root, "bin-release");
		writeRelease(installDir, "1.0.0");
		return {
			installMethod: "bun-binary" as const,
			autoUpdate: true,
			appMode: "interactive" as const,
			installDir,
			env: {},
			...overrides,
		};
	}

	it("allows an interactive standalone binary in a release directory", () => {
		expect(canAutoUpdateBinary(conditions())).toBe(true);
	});

	it("is off when the setting is off", () => {
		expect(canAutoUpdateBinary(conditions({ autoUpdate: false }))).toBe(false);
	});

	it("is off offline or with version checks skipped", () => {
		expect(canAutoUpdateBinary(conditions({ env: { AKRAMCODE_OFFLINE: "1" } }))).toBe(false);
		expect(canAutoUpdateBinary(conditions({ env: { AKRAMCODE_SKIP_VERSION_CHECK: "1" } }))).toBe(false);
	});

	it("is off for package-manager installs", () => {
		expect(canAutoUpdateBinary(conditions({ installMethod: "npm" }))).toBe(false);
	});

	it("is off outside interactive mode", () => {
		expect(canAutoUpdateBinary(conditions({ appMode: "print" }))).toBe(false);
		expect(canAutoUpdateBinary(conditions({ appMode: "json" }))).toBe(false);
		expect(canAutoUpdateBinary(conditions({ appMode: "rpc" }))).toBe(false);
	});

	it("is off when the binary is not in an unpacked release directory", () => {
		const loneBinaryDir = join(root, "bin");
		mkdirSync(loneBinaryDir);
		writeFileSync(join(loneBinaryDir, "akramcode"), "binary");
		expect(canAutoUpdateBinary(conditions({ installDir: loneBinaryDir }))).toBe(false);
	});
});
