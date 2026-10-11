import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Args, parseArgs } from "../src/cli/args.ts";
import { planSessionImport, SessionImportFileNotFoundError } from "../src/core/agent-session-runtime.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createSessionManager } from "../src/main.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type InteractiveModePrototype = {
	getPathCommandArgument(this: unknown, text: string, command: "/share"): string | undefined;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "akramcode-session-import-")));
	tempDirs.push(dir);
	return dir;
}

function args(overrides: Partial<Args>): Args {
	return { messages: [], fileArgs: [], unknownFlags: new Map(), diagnostics: [], ...overrides };
}

/** A stored session for `cwd` with one user message, copied out of its session directory. */
function writeExportedSession(cwd: string, target: string): void {
	const source = SessionManager.create(cwd, join(cwd, ".source-sessions"));
	source.appendMessage({ role: "user", content: "hello from export", timestamp: 1 });
	source.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "hi" }],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 2,
	});
	writeFileSync(target, readFileSync(source.getSessionFile()!, "utf8"));
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("/share path argument", () => {
	it("strips quotes and keeps apostrophes", () => {
		expect(interactiveModePrototype.getPathCommandArgument('/share "path with spaces/a.jsonl"', "/share")).toBe(
			"path with spaces/a.jsonl",
		);
		expect(interactiveModePrototype.getPathCommandArgument("/share john's/a.html", "/share")).toBe("john's/a.html");
	});

	it("returns nothing without a path, which opens the format choice", () => {
		expect(interactiveModePrototype.getPathCommandArgument("/share", "/share")).toBeUndefined();
		expect(interactiveModePrototype.getPathCommandArgument("/sharer out.html", "/share")).toBeUndefined();
	});
});

describe("--import", () => {
	it("parses the session file path", () => {
		expect(parseArgs(["--import", "session.jsonl"]).import).toBe("session.jsonl");
	});

	it("copies the file into the session directory under a free name", () => {
		const dir = createTempDir();
		const sessionDir = join(dir, "sessions");
		mkdirSync(sessionDir);
		writeFileSync(join(dir, "a.jsonl"), "x");
		writeFileSync(join(sessionDir, "a.jsonl"), "taken");

		const { destinationPath, copy } = planSessionImport(join(dir, "a.jsonl"), sessionDir);
		copy();

		expect(destinationPath).toBe(join(sessionDir, "a-1.jsonl"));
		expect(readFileSync(destinationPath, "utf8")).toBe("x");
		expect(() => planSessionImport(join(dir, "missing.jsonl"), sessionDir)).toThrow(SessionImportFileNotFoundError);
	});

	it("opens a copy of the imported session and leaves the original file untouched", async () => {
		const dir = createTempDir();
		const exported = join(dir, "exported.jsonl");
		writeExportedSession(dir, exported);
		const original = readFileSync(exported, "utf8");
		const sessionDir = join(dir, "sessions");

		const manager = await createSessionManager(
			args({ import: exported }),
			dir,
			sessionDir,
			SettingsManager.inMemory(),
		);

		expect(manager.getSessionFile()).toBe(join(sessionDir, "exported.jsonl"));
		expect(JSON.stringify(manager.getEntries())).toContain("hello from export");
		expect(readFileSync(exported, "utf8")).toBe(original);
	});
});
