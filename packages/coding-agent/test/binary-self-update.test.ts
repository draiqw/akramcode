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
import { findSha256, getBinaryReleaseAssetName, runBinarySelfUpdate } from "../src/utils/binary-self-update.ts";

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

function stubReleaseFetch(version: string, archive: Buffer, sha = createHash("sha256").update(archive).digest("hex")) {
	const fetchMock = vi.fn(async (input: string | URL | Request) => {
		const url = String(input);
		if (url === `${BASE_URL}/v${version}/${ASSET}`) return new Response(new Uint8Array(archive));
		if (url === `${BASE_URL}/v${version}/SHA256SUMS`) return new Response(`${sha}  ${ASSET}\n`);
		return new Response("not found", { status: 404 });
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "akramcode-binary-update-"));
});

afterEach(() => {
	vi.unstubAllGlobals();
	rmSync(root, { force: true, recursive: true });
});

describe("binary self-update", () => {
	it("maps platforms to release assets", () => {
		expect(getBinaryReleaseAssetName("darwin", "arm64")).toBe("akramcode-darwin-arm64.tar.gz");
		expect(getBinaryReleaseAssetName("linux", "x64")).toBe("akramcode-linux-x64.tar.gz");
		expect(getBinaryReleaseAssetName("win32", "x64")).toBeUndefined();
		expect(getBinaryReleaseAssetName("linux", "ia32")).toBeUndefined();
	});

	it("parses sha256sum and shasum listings", () => {
		const hash = "a".repeat(64);
		expect(findSha256(`${hash}  ${ASSET}\n`, ASSET)).toBe(hash);
		expect(findSha256(`${hash} *${ASSET}\n`, ASSET)).toBe(hash);
		expect(findSha256(`${hash}  other.tar.gz\n`, ASSET)).toBeUndefined();
	});

	it("replaces the install directory with the verified release", async () => {
		const installDir = join(root, "bin-release");
		writeRelease(installDir, "1.0.0");
		writeFileSync(join(installDir, "stale.txt"), "old");
		stubReleaseFetch("1.2.0", buildArchive("1.2.0"));

		await runBinarySelfUpdate({
			version: "1.2.0",
			installDir,
			platform: "linux",
			arch: "x64",
			releaseBaseUrl: BASE_URL,
		});

		expect(readFileSync(join(installDir, "akramcode"), "utf8")).toContain("echo 1.2.0");
		expect(existsSync(join(installDir, "stale.txt"))).toBe(false);
		expect(readdirSync(root).filter((entry) => entry.startsWith(".bin-release-"))).toEqual([]);
	});

	it("keeps the current installation on a checksum mismatch", async () => {
		const installDir = join(root, "bin-release");
		writeRelease(installDir, "1.0.0");
		stubReleaseFetch("1.2.0", buildArchive("1.2.0"), "0".repeat(64));

		await expect(
			runBinarySelfUpdate({
				version: "1.2.0",
				installDir,
				platform: "linux",
				arch: "x64",
				releaseBaseUrl: BASE_URL,
			}),
		).rejects.toThrow(/Checksum mismatch/);
		expect(readFileSync(join(installDir, "akramcode"), "utf8")).toContain("echo 1.0.0");
		expect(readdirSync(root).filter((entry) => entry.startsWith(".bin-release-"))).toEqual([]);
	});

	it("rejects a release whose binary reports another version", async () => {
		const installDir = join(root, "bin-release");
		writeRelease(installDir, "1.0.0");
		stubReleaseFetch("1.2.0", buildArchive("1.1.0"));

		await expect(
			runBinarySelfUpdate({
				version: "1.2.0",
				installDir,
				platform: "linux",
				arch: "x64",
				releaseBaseUrl: BASE_URL,
			}),
		).rejects.toThrow(/reports version 1\.1\.0; expected 1\.2\.0/);
		expect(readFileSync(join(installDir, "akramcode"), "utf8")).toContain("echo 1.0.0");
	});

	it("refuses directories that are not an unpacked release", async () => {
		const installDir = join(root, "bin");
		mkdirSync(installDir);
		writeFileSync(join(installDir, "akramcode"), "binary");
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			runBinarySelfUpdate({
				version: "1.2.0",
				installDir,
				platform: "linux",
				arch: "x64",
				releaseBaseUrl: BASE_URL,
			}),
		).rejects.toThrow(/does not look like an unpacked akramcode release/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("refuses unsupported platforms", async () => {
		const installDir = join(root, "bin-release");
		writeRelease(installDir, "1.0.0");
		await expect(
			runBinarySelfUpdate({
				version: "1.2.0",
				installDir,
				platform: "win32",
				arch: "x64",
				releaseBaseUrl: BASE_URL,
			}),
		).rejects.toThrow(/No standalone akramcode build is published for win32-x64/);
	});
});
