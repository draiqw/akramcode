import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { withFileMutationQueue } from "../src/core/tools/file-mutation-queue.ts";
import { createGrepToolDefinition, type GrepToolInput } from "../src/core/tools/grep.ts";
import {
	buildTgrepArgs,
	findTgrepServer,
	type ProbeResult,
	TGREP_SERVER_MARKER,
	type TgrepServerProbe,
} from "../src/core/tools/grep-tgrep.ts";

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n");
}

function matchEvent(filePath: string, lineNumber: number, text: string): string {
	return JSON.stringify({
		type: "match",
		data: { path: { text: filePath }, line_number: lineNumber, lines: { text: `${text}\n` } },
	});
}

const uid = process.getuid?.() ?? 0;

/** lsof -F output of a valid tgrep server process. */
function lsofRecords(options: { pid: number; binary: string; indexDir: string; port: number }): string {
	return [
		`p${options.pid}`,
		`u${uid}`,
		"ftxt",
		"tREG",
		`n${options.binary}`,
		"f3",
		"tREG",
		`n${join(options.indexDir, "serve.lock")}`,
		"f6",
		"tIPv4",
		`n127.0.0.1:${options.port}`,
		"TST=LISTEN",
		"",
	].join("\n");
}

interface FakeTgrep {
	stdout?: string[];
	stderr?: string;
	exitCode?: number;
	sleepSeconds?: number;
}

describe("grep tool tgrep backend", () => {
	let root: string;
	let fakeDir: string;
	let fakeTgrep: string;
	let argsFile: string;

	const writeFakeTgrep = (fake: FakeTgrep) => {
		writeFileSync(join(fakeDir, "stdout.jsonl"), `${(fake.stdout ?? []).join("\n")}\n`);
		writeFileSync(join(fakeDir, "stderr.txt"), `${fake.stderr ?? ""}\n`);
		const sleep = fake.sleepSeconds ? `sleep ${fake.sleepSeconds}\n` : "";
		writeFileSync(
			fakeTgrep,
			`#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\n${sleep}cat "${join(fakeDir, "stdout.jsonl")}"\ncat "${join(fakeDir, "stderr.txt")}" >&2\nexit ${fake.exitCode ?? 0}\n`,
		);
		chmodSync(fakeTgrep, 0o755);
	};
	let savedPath: string | undefined;
	// Writes the discovery file and what the fake lsof reports for a matching server process.
	const writeServeJson = (pid: number, dir = root) => {
		const indexDir = join(dir, ".tgrep");
		mkdirSync(indexDir, { recursive: true });
		writeFileSync(join(indexDir, "serve.json"), JSON.stringify({ pid, port: 4321 }));
		writeFileSync(join(indexDir, "serve.lock"), "");
		writeFileSync(join(fakeDir, "lsof.txt"), lsofRecords({ pid, binary: fakeTgrep, indexDir, port: 4321 }));
	};
	const tgrepArgs = (): string[] | undefined =>
		existsSync(argsFile) ? readFileSync(argsFile, "utf-8").trimEnd().split("\n") : undefined;
	const grep = (
		input: GrepToolInput,
		options?: Parameters<typeof createGrepToolDefinition>[1],
		signal?: AbortSignal,
	) =>
		createGrepToolDefinition(root, { backend: "tgrep", tgrepPath: fakeTgrep, ...options }).execute(
			"call",
			input,
			signal,
			undefined,
			undefined as any,
		);

	beforeEach(() => {
		const base = join(tmpdir(), `grep-tgrep-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		root = join(base, "repo");
		fakeDir = join(base, "fake");
		mkdirSync(join(root, "src"), { recursive: true });
		mkdirSync(fakeDir, { recursive: true });
		fakeTgrep = join(fakeDir, "tgrep");
		argsFile = join(fakeDir, "args.txt");
		writeFileSync(join(root, "src", "a.ts"), "const needle = 1;\nconst other = 2;\n");
		const binDir = join(fakeDir, "bin");
		mkdirSync(binDir);
		writeFileSync(join(binDir, "lsof"), `#!/bin/sh\ncat "${join(fakeDir, "lsof.txt")}"\n`);
		chmodSync(join(binDir, "lsof"), 0o755);
		savedPath = process.env.PATH;
		process.env.PATH = `${binDir}${delimiter}${savedPath ?? ""}`;
	});

	afterEach(() => {
		process.env.PATH = savedPath;
		rmSync(join(root, ".."), { recursive: true, force: true });
	});

	it("uses the tgrep server result when the server answered", async () => {
		writeServeJson(process.pid);
		writeFakeTgrep({
			stdout: [matchEvent(join(root, "src", "a.ts"), 1, "const needle = 1; // from tgrep")],
			stderr: `1 matches (1 matched lines) in 0.1ms ${TGREP_SERVER_MARKER}`,
		});

		const result = await grep({ pattern: "needle", ignoreCase: true, literal: true, glob: "*.ts", limit: 5 });

		expect(textOf(result)).toBe("src/a.ts:1: const needle = 1; // from tgrep");
		expect(tgrepArgs()).toEqual([
			"--json",
			"--line-number",
			"--color=never",
			"--hidden",
			"--stats",
			"--index-path",
			join(root, ".tgrep"),
			"--max-count",
			"5",
			"--ignore-case",
			"--fixed-strings",
			"--glob",
			"*.ts",
			"--",
			"needle",
			root,
		]);
	});

	it("formats tgrep results like ripgrep results, including the match limit notice", async () => {
		writeServeJson(process.pid);
		const file = join(root, "src", "a.ts");
		writeFakeTgrep({
			stdout: [
				JSON.stringify({ type: "begin", data: { path: { text: file } } }),
				matchEvent(file, 1, "const needle = 1;"),
				matchEvent(file, 2, "const other = 2;"),
			],
			stderr: TGREP_SERVER_MARKER,
		});
		const viaTgrep = textOf(await grep({ pattern: "const", limit: 1 }));

		const viaRipgrep = textOf(
			await createGrepToolDefinition(root).execute(
				"call",
				{ pattern: "const", limit: 1 },
				undefined,
				undefined,
				undefined as any,
			),
		);
		expect(viaTgrep).toBe(viaRipgrep);
		expect(viaTgrep).toContain("[1 matches limit reached. Use limit=2 for more, or refine pattern]");
	});

	it("finds the server of a parent directory and keeps paths relative to the search path", async () => {
		writeServeJson(process.pid);
		writeFakeTgrep({
			stdout: [matchEvent(join(root, "src", "a.ts"), 1, "const needle = 1;")],
			stderr: TGREP_SERVER_MARKER,
		});

		const result = await grep({ pattern: "needle", path: "src" });

		expect(textOf(result)).toBe("a.ts:1: const needle = 1;");
		expect(tgrepArgs()).toContain(join(root, ".tgrep"));
		expect(tgrepArgs()?.at(-1)).toBe(join(root, "src"));
	});

	it("trusts an empty server result for the indexed root", async () => {
		writeServeJson(process.pid);
		writeFakeTgrep({ stderr: `0 matches (0 matched lines) in 0.1ms ${TGREP_SERVER_MARKER}`, exitCode: 1 });

		expect(textOf(await grep({ pattern: "needle" }))).toBe("No matches found");
	});

	it("lets ripgrep confirm an empty server result below the indexed root", async () => {
		// The server has no files of an ignored directory, but ripgrep searches it when it is named.
		writeServeJson(process.pid);
		writeFakeTgrep({ stderr: `0 matches (0 matched lines) in 0.1ms ${TGREP_SERVER_MARKER}`, exitCode: 1 });

		const result = await grep({ pattern: "needle", path: "src" });

		expect(tgrepArgs()).toBeDefined();
		expect(textOf(result)).toBe("a.ts:1: const needle = 1;");
	});

	it("falls back to ripgrep when tgrep did not use the server", async () => {
		writeServeJson(process.pid);
		writeFakeTgrep({
			stdout: [matchEvent(join(root, "src", "a.ts"), 1, "stale index line")],
			stderr: "Server unavailable or index coverage not ready, falling back to local index",
		});

		const result = await grep({ pattern: "needle" });

		expect(tgrepArgs()).toBeDefined();
		expect(textOf(result)).toBe("src/a.ts:1: const needle = 1;");
	});

	it("falls back to ripgrep when tgrep fails", async () => {
		writeServeJson(process.pid);
		writeFakeTgrep({ stderr: `error: bad pattern ${TGREP_SERVER_MARKER}`, exitCode: 2 });

		const result = await grep({ pattern: "needle" });

		expect(tgrepArgs()).toBeDefined();
		expect(textOf(result)).toBe("src/a.ts:1: const needle = 1;");
	});

	it("falls back to ripgrep when the tgrep executable is missing", async () => {
		writeServeJson(process.pid);

		const result = await grep({ pattern: "needle" }, { tgrepPath: join(fakeDir, "missing-tgrep") });

		expect(textOf(result)).toBe("src/a.ts:1: const needle = 1;");
	});

	it("reports ripgrep errors after a tgrep fallback", async () => {
		writeServeJson(process.pid);
		writeFakeTgrep({ exitCode: 2 });

		await expect(grep({ pattern: "(" })).rejects.toThrow(/regex parse error/);
	});

	it("does not run tgrep without a live server", async () => {
		writeFakeTgrep({ stdout: [matchEvent(join(root, "src", "a.ts"), 1, "from tgrep")], stderr: TGREP_SERVER_MARKER });

		expect(textOf(await grep({ pattern: "needle" }))).toBe("src/a.ts:1: const needle = 1;");
		expect(tgrepArgs()).toBeUndefined();

		// A PID above the macOS and Linux limits cannot belong to a running process.
		writeServeJson(2 ** 31 - 2);
		expect(textOf(await grep({ pattern: "needle" }))).toBe("src/a.ts:1: const needle = 1;");
		expect(tgrepArgs()).toBeUndefined();
	});

	it("does not run tgrep for a file path, the rg backend, or custom operations", async () => {
		writeServeJson(process.pid);
		writeFakeTgrep({ stdout: [matchEvent(join(root, "src", "a.ts"), 1, "from tgrep")], stderr: TGREP_SERVER_MARKER });

		expect(textOf(await grep({ pattern: "needle", path: "src/a.ts" }))).toBe("a.ts:1: const needle = 1;");
		expect(textOf(await grep({ pattern: "needle" }, { backend: "rg" }))).toBe("src/a.ts:1: const needle = 1;");
		const operations = {
			isDirectory: () => true,
			readFile: (p: string) => readFileSync(p, "utf-8"),
		};
		expect(textOf(await grep({ pattern: "needle" }, { operations }))).toBe("src/a.ts:1: const needle = 1;");
		expect(tgrepArgs()).toBeUndefined();
	});

	it("falls back to ripgrep when a broad query keeps printing past the match limit", async () => {
		writeServeJson(process.pid);
		const file = join(root, "src", "a.ts");
		const longLine = `const needle = "${"x".repeat(500)}";`;
		writeFakeTgrep({
			stdout: Array.from({ length: 3000 }, (_, i) => matchEvent(file, i + 1, longLine)),
			stderr: TGREP_SERVER_MARKER,
		});

		const result = await grep({ pattern: "needle", limit: 1 });

		expect(tgrepArgs()).toBeDefined();
		expect(textOf(result)).toContain("src/a.ts:1: const needle = 1;");
	});

	it("ignores a discovery file that the repository ships", async () => {
		writeServeJson(process.pid);
		writeFakeTgrep({ stdout: [matchEvent(join(root, "src", "a.ts"), 1, "spoofed")], stderr: TGREP_SERVER_MARKER });
		const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
		git("init", "-q");
		git("add", "-f", ".tgrep/serve.json");

		expect(textOf(await grep({ pattern: "needle" }))).toBe("src/a.ts:1: const needle = 1;");
		expect(tgrepArgs()).toBeUndefined();
	});

	it("rejects an aborted tgrep search without falling back", async () => {
		writeServeJson(process.pid);
		writeFakeTgrep({ sleepSeconds: 5, stderr: TGREP_SERVER_MARKER });
		const controller = new AbortController();

		const pending = grep({ pattern: "needle" }, undefined, controller.signal);
		await new Promise((resolve) => setTimeout(resolve, 200));
		controller.abort();

		await expect(pending).rejects.toThrow("Operation aborted");
	});

	// Runs last: the mutation leaves a module-wide grace period behind.
	it("uses ripgrep right after a file mutation", async () => {
		writeServeJson(process.pid);
		writeFakeTgrep({ stdout: [matchEvent(join(root, "src", "a.ts"), 1, "from tgrep")], stderr: TGREP_SERVER_MARKER });

		await withFileMutationQueue(join(root, "src", "a.ts"), async () => {
			writeFileSync(join(root, "src", "a.ts"), "const needle = 3;\n");
		});
		const result = await grep({ pattern: "needle" });

		expect(textOf(result)).toBe("src/a.ts:1: const needle = 3;");
		expect(tgrepArgs()).toBeUndefined();
	});
});

describe("tgrep server verification", () => {
	let root: string;
	let indexDir: string;
	let binary: string;
	let lsofOutput: string;
	let gitResult: ProbeResult | undefined;
	let gitArgs: string[] = [];
	let probeUid: number;
	let lsofCalls: number;

	const probe: TgrepServerProbe = {
		getuid: () => probeUid,
		run: async (command, args) => {
			if (command === "git") {
				gitArgs = args;
				return gitResult;
			}
			lsofCalls++;
			return { status: 0, stdout: lsofOutput, stderr: "" };
		},
	};
	const find = () => findTgrepServer(join(root, "src"), binary, probe);
	const writeServe = (info: unknown) => writeFileSync(join(indexDir, "serve.json"), JSON.stringify(info));

	beforeEach(() => {
		const base = join(tmpdir(), `grep-tgrep-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		root = join(base, "repo");
		indexDir = join(root, ".tgrep");
		mkdirSync(join(root, "src"), { recursive: true });
		mkdirSync(indexDir);
		chmodSync(indexDir, 0o755);
		binary = join(base, "tgrep");
		writeFileSync(binary, "#!/bin/sh\n");
		chmodSync(binary, 0o755);
		writeServe({ pid: process.pid, port: 4321 });
		chmodSync(join(indexDir, "serve.json"), 0o644);
		writeFileSync(join(indexDir, "serve.lock"), "");
		lsofOutput = lsofRecords({ pid: process.pid, binary, indexDir, port: 4321 });
		gitResult = {
			status: 128,
			stdout: "",
			stderr: "fatal: not a git repository (or any of the parent directories): .git",
		};
		probeUid = uid;
		lsofCalls = 0;
	});

	afterEach(() => {
		rmSync(join(root, ".."), { recursive: true, force: true });
	});

	it("accepts a server that passes every check and caches the verification", async () => {
		const server = await find();
		expect(server?.indexDir).toBe(indexDir);
		expect(server?.binary).toBe(realpathSync(binary));
		expect(await find()).toEqual(server);
		expect(lsofCalls).toBe(1);
	});

	it("accepts an untracked discovery file in a git repository, with the repository's fsmonitor disabled", async () => {
		gitResult = { status: 0, stdout: "", stderr: "" };
		expect(await find()).toBeDefined();
		expect(gitArgs.slice(0, 3)).toEqual(["-c", "core.fsmonitor=false", "ls-files"]);
	});

	it("returns undefined without a discovery file or executable", async () => {
		rmSync(join(indexDir, "serve.json"));
		expect(await find()).toBeUndefined();
		writeServe({ pid: process.pid, port: 4321 });
		binary = join(root, "missing-tgrep");
		expect(await find()).toBeUndefined();
	});

	it("rejects a discovery file writable by group or others", async () => {
		chmodSync(join(indexDir, "serve.json"), 0o664);
		expect(await find()).toBeUndefined();
		chmodSync(join(indexDir, "serve.json"), 0o646);
		expect(await find()).toBeUndefined();
	});

	it("rejects an index directory or indexed root writable by group or others", async () => {
		chmodSync(indexDir, 0o775);
		expect(await find()).toBeUndefined();
		chmodSync(indexDir, 0o755);
		chmodSync(root, 0o777);
		expect(await find()).toBeUndefined();
	});

	it("rejects a discovery file of another user", async () => {
		probeUid = uid + 1;
		expect(await find()).toBeUndefined();
	});

	it("rejects a symlinked discovery file or index directory", async () => {
		const elsewhere = join(root, "..", "elsewhere.json");
		writeFileSync(elsewhere, JSON.stringify({ pid: process.pid, port: 4321 }));
		rmSync(join(indexDir, "serve.json"));
		symlinkSync(elsewhere, join(indexDir, "serve.json"));
		expect(await find()).toBeUndefined();

		const realIndex = join(root, "..", "real-index");
		rmSync(indexDir, { recursive: true });
		mkdirSync(realIndex);
		writeFileSync(join(realIndex, "serve.json"), JSON.stringify({ pid: process.pid, port: 4321 }));
		symlinkSync(realIndex, indexDir);
		expect(await find()).toBeUndefined();
	});

	it("rejects a discovery file that git tracks or when git cannot run", async () => {
		gitResult = { status: 0, stdout: ".tgrep/serve.json\n", stderr: "" };
		expect(await find()).toBeUndefined();
		gitResult = undefined;
		expect(await find()).toBeUndefined();
		gitResult = { status: 1, stdout: "", stderr: "fatal: something else" };
		expect(await find()).toBeUndefined();
	});

	it("rejects an invalid pid or port", async () => {
		for (const info of [
			{ pid: 0, port: 4321 },
			{ pid: "1", port: 4321 },
			{ pid: process.pid, port: 0 },
			{ pid: process.pid, port: 70000 },
			{ pid: process.pid },
		]) {
			writeServe(info);
			expect(await find()).toBeUndefined();
		}
	});

	it("rejects a pid that is not running", async () => {
		writeServe({ pid: 2 ** 31 - 2, port: 4321 });
		expect(await find()).toBeUndefined();
		expect(lsofCalls).toBe(0);
	});

	it("rejects a process when lsof fails", async () => {
		const failing: TgrepServerProbe = {
			...probe,
			run: async (command) => (command === "git" ? gitResult : undefined),
		};
		expect(await findTgrepServer(join(root, "src"), binary, failing)).toBeUndefined();
		const erroring: TgrepServerProbe = {
			...probe,
			run: async (command) => (command === "git" ? gitResult : { status: 1, stdout: lsofOutput, stderr: "" }),
		};
		expect(await findTgrepServer(join(root, "src"), binary, erroring)).toBeUndefined();
	});

	it("rejects a process of another user", async () => {
		lsofOutput = lsofOutput.replace(`u${uid}`, `u${uid + 1}`);
		expect(await find()).toBeUndefined();
	});

	it("rejects a process that runs another executable", async () => {
		lsofOutput = lsofOutput.replace(`n${binary}`, "n/bin/sh");
		expect(await find()).toBeUndefined();
	});

	it("rejects a process that does not hold the server lock of this index", async () => {
		lsofOutput = lsofOutput.replace(`n${join(indexDir, "serve.lock")}`, "n/tmp/other/.tgrep/serve.lock");
		expect(await find()).toBeUndefined();
	});

	it("rejects a server that does not listen on the named port on loopback", async () => {
		const valid = lsofOutput;
		for (const replacement of ["n0.0.0.0:4321", "n192.168.1.5:4321", "n127.0.0.1:9999", "n*:4321"]) {
			lsofOutput = valid.replace("n127.0.0.1:4321", replacement);
			expect(await find()).toBeUndefined();
		}
		lsofOutput = valid.replace("TST=LISTEN", "TST=ESTABLISHED");
		expect(await find()).toBeUndefined();
		lsofOutput = valid.replace("tIPv4\nn127.0.0.1:4321", "tIPv6\nn[::1]:4321");
		expect(await find()).toBeDefined();
	});
});

describe("tgrep helpers", () => {
	it("puts all flags before the pattern separator", () => {
		const args = buildTgrepArgs({ indexDir: "/r/.tgrep", pattern: "-x", searchPath: "/r", limit: 3 });
		expect(args.slice(-3)).toEqual(["--", "-x", "/r"]);
		expect(args).not.toContain("--glob");
	});
});

describe("grep settings", () => {
	it("defaults to ripgrep and reads the tgrep backend and path", () => {
		expect(SettingsManager.inMemory().getGrepBackend()).toBe("rg");
		expect(SettingsManager.inMemory().getGrepTgrepPath()).toBeUndefined();
		const settings = SettingsManager.inMemory({ grep: { backend: "tgrep", tgrepPath: "~/bin/tgrep" } });
		expect(settings.getGrepBackend()).toBe("tgrep");
		expect(settings.getGrepTgrepPath()).toBe(join(homedir(), "bin", "tgrep"));
	});

	it("treats an unknown backend as ripgrep", () => {
		expect(SettingsManager.inMemory({ grep: { backend: "ag" as any } }).getGrepBackend()).toBe("rg");
	});
});
