import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPythonAliases } from "../src/utils/shell.ts";

describe.skipIf(process.platform === "win32")("createPythonAliases", () => {
	let root: string;
	let binDir: string;
	let aliasDir: string;
	const originalPath = process.env.PATH;

	// PATH holds only the fake interpreters and `which`, so the host's own python does not leak in.
	function install(name: string, majorVersion: number): string {
		const path = join(binDir, name);
		writeFileSync(path, `#!/bin/sh\necho ${majorVersion}\n`);
		chmodSync(path, 0o755);
		return path;
	}

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "akramcode-python-aliases-"));
		binDir = join(root, "bin");
		aliasDir = join(root, "aliases");
		mkdirSync(binDir);
		const which = spawnSync("sh", ["-c", "command -v which"], { encoding: "utf-8" }).stdout.trim();
		symlinkSync(which, join(binDir, "which"));
		process.env.PATH = binDir;
	});

	afterEach(() => {
		process.env.PATH = originalPath;
		rmSync(root, { recursive: true, force: true });
	});

	it("links python to python3 when only python3 is installed", () => {
		const python3 = install("python3", 3);
		expect(createPythonAliases(aliasDir)).toBe(true);
		expect(readlinkSync(join(aliasDir, "python"))).toBe(python3);
	});

	it("links python3 to a Python 3 python when only python is installed", () => {
		const python = install("python", 3);
		expect(createPythonAliases(aliasDir)).toBe(true);
		expect(readlinkSync(join(aliasDir, "python3"))).toBe(python);
	});

	it("does not link python3 to a Python 2 python", () => {
		install("python", 2);
		expect(createPythonAliases(aliasDir)).toBe(false);
		expect(existsSync(join(aliasDir, "python3"))).toBe(false);
	});

	it("adds nothing when both names are installed", () => {
		install("python", 3);
		install("python3", 3);
		expect(createPythonAliases(aliasDir)).toBe(false);
		expect(existsSync(aliasDir)).toBe(false);
	});
});
