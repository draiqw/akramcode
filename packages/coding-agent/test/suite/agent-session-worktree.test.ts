import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@akramcode/providers";
import { afterEach, describe, expect, it } from "vitest";
import { formatWorktreeDate, slugify, WORKTREE_ENTRY_TYPE } from "../../src/core/worktree.ts";
import { createHarness, createTestUiContext, type Harness, type HarnessOptions } from "./harness.ts";

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function initRepo(dir: string): void {
	git(dir, "init", "-q", "-b", "main");
	writeFileSync(join(dir, "README.md"), "hello\n");
	git(dir, "add", "README.md");
	git(dir, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "init");
}

const today = () => formatWorktreeDate(new Date());

describe("AgentSession worktrees", () => {
	const harnesses: Harness[] = [];
	const extraDirs: string[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
		while (extraDirs.length > 0) rmSync(extraDirs.pop()!, { recursive: true, force: true });
	});

	const setup = async (options: HarnessOptions & { repo?: boolean; ui?: boolean } = {}) => {
		const harness = await createHarness(options);
		harnesses.push(harness);
		if (options.ui !== false) await harness.session.bindExtensions({ uiContext: createTestUiContext() });
		if (options.repo !== false) initRepo(harness.tempDir);
		return harness;
	};

	const worktrees = (harness: Harness): string[] => {
		const dir = join(harness.tempDir, ".worktrees");
		return existsSync(dir) ? readdirSync(dir) : [];
	};

	it("stays in the main checkout for a read-only turn", async () => {
		const harness = await setup();
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("read", { path: "README.md" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("It says hello."),
		]);

		await harness.session.prompt("What does the readme say?");

		expect(worktrees(harness)).toEqual([]);
		expect(harness.session.cwd).toBe(harness.tempDir);
		expect(harness.eventsOfType("cwd_changed")).toEqual([]);
	});

	it("moves into a worktree named by the model before the first write", async () => {
		const harness = await setup();
		const mainPath = join(harness.tempDir, "src", "a.txt");
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: mainPath, content: "changed\n" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Fix Login Redirect"),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("Please fix the login redirect");

		const name = `${today()}-fix-login-redirect`;
		const worktreePath = join(realpathSync(harness.tempDir), ".worktrees", name);
		expect(worktrees(harness)).toEqual([name]);
		expect(readFileSync(join(worktreePath, "src", "a.txt"), "utf-8")).toBe("changed\n");
		expect(existsSync(mainPath)).toBe(false);
		expect(git(harness.tempDir, "branch", "--list", name)).toContain(name);
		expect(git(harness.tempDir, "branch", "--show-current")).toBe("main");
		expect(readFileSync(join(harness.tempDir, ".git", "info", "exclude"), "utf-8")).toContain(".worktrees/");
		expect(git(harness.tempDir, "status", "--porcelain")).toBe("");

		expect(harness.session.cwd).toBe(worktreePath);
		expect(harness.eventsOfType("cwd_changed")).toEqual([{ type: "cwd_changed", cwd: worktreePath }]);
		expect(harness.session.systemPrompt).toContain(`<cwd>\n${worktreePath}\n</cwd>`);
		expect(harness.session.systemPrompt).toContain(`branch ${name}`);
		const entry = harness.sessionManager
			.getEntries()
			.find((candidate) => candidate.type === "custom" && candidate.customType === WORKTREE_ENTRY_TYPE);
		expect(entry?.type === "custom" ? entry.data : undefined).toMatchObject({
			sessionId: harness.session.sessionId,
			mainRoot: realpathSync(harness.tempDir),
			path: worktreePath,
			branch: name,
			dirtyCount: 0,
		});
	});

	it("moves before a bash command that changes git state", async () => {
		const harness = await setup();
		harness.session.setSessionName("Branch work");
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "git checkout -q -b feature" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("Make a feature branch");

		const worktreePath = join(realpathSync(harness.tempDir), ".worktrees", `${today()}-branch-work`);
		expect(git(harness.tempDir, "branch", "--show-current")).toBe("main");
		expect(git(worktreePath, "branch", "--show-current")).toBe("feature");
	});

	it("maps main checkout paths of later reads into the worktree", async () => {
		const harness = await setup();
		harness.session.setSessionName("edit readme");
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "README.md", content: "changed\n" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(fauxToolCall("read", { path: join(harness.tempDir, "README.md") }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("Change the readme");

		expect(readFileSync(join(harness.tempDir, "README.md"), "utf-8")).toBe("hello\n");
		const read = harness.session.messages.findLast(
			(message) => message.role === "toolResult" && message.toolName === "read",
		);
		expect(JSON.stringify(read)).toContain("changed");
	});

	it("does nothing outside a git repository", async () => {
		const harness = await setup({ repo: false });
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.txt", content: "x" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("Write a file");

		expect(readFileSync(join(harness.tempDir, "a.txt"), "utf-8")).toBe("x");
		expect(worktrees(harness)).toEqual([]);
		expect(harness.session.cwd).toBe(harness.tempDir);
	});

	it("does nothing in a linked worktree", async () => {
		const harness = await setup({ repo: false });
		const repoDir = `${harness.tempDir}-repo`;
		extraDirs.push(repoDir);
		mkdirSync(repoDir);
		initRepo(repoDir);
		rmSync(harness.tempDir, { recursive: true, force: true });
		git(repoDir, "worktree", "add", "-q", "-b", "linked", harness.tempDir);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.txt", content: "x" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("Write a file");

		expect(readFileSync(join(harness.tempDir, "a.txt"), "utf-8")).toBe("x");
		expect(worktrees(harness)).toEqual([]);
		expect(existsSync(join(repoDir, ".worktrees"))).toBe(false);
	});

	it("does nothing when worktrees are disabled", async () => {
		const harness = await setup({ settings: { worktrees: { enabled: false } } });
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.txt", content: "x" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("Write a file");

		expect(readFileSync(join(harness.tempDir, "a.txt"), "utf-8")).toBe("x");
		expect(worktrees(harness)).toEqual([]);
	});

	it("changes files in place without a UI, as in print and JSON modes", async () => {
		const harness = await setup({ ui: false });
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.txt", content: "x" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("Write a file");

		expect(readFileSync(join(harness.tempDir, "a.txt"), "utf-8")).toBe("x");
		expect(worktrees(harness)).toEqual([]);
		expect(harness.session.systemPrompt).not.toContain("git checkout is shared with other sessions");
	});

	it("creates one worktree for parallel writes", async () => {
		const harness = await setup();
		harness.session.setSessionName("two files");
		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("write", { path: "a.txt", content: "a" }),
					fauxToolCall("write", { path: "b.txt", content: "b" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("Write two files");

		const name = `${today()}-two-files`;
		expect(worktrees(harness)).toEqual([name]);
		expect(readFileSync(join(harness.tempDir, ".worktrees", name, "a.txt"), "utf-8")).toBe("a");
		expect(readFileSync(join(harness.tempDir, ".worktrees", name, "b.txt"), "utf-8")).toBe("b");
		expect(harness.eventsOfType("cwd_changed")).toHaveLength(1);
	});

	it("adds a suffix when the name is taken", async () => {
		const harness = await setup();
		harness.session.setSessionName("same name");
		git(harness.tempDir, "branch", `${today()}-same-name`);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.txt", content: "a" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("Write a file");

		expect(worktrees(harness)).toEqual([`${today()}-same-name-2`]);
	});

	it("names the worktree from the prompt when the model call fails", async () => {
		const harness = await setup();
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.txt", content: "a" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "naming failed" }),
			fauxAssistantMessage("Done."),
		]);

		await harness.session.prompt("Исправить вход в систему, пожалуйста");

		expect(worktrees(harness)).toEqual([`${today()}-ispravit-vkhod-v-sistemu`]);
	});

	it("re-enters its worktree on resume and recreates a removed directory", async () => {
		const harness = await setup();
		harness.session.setSessionName("resume me");
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "a.txt", content: "a" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Done."),
		]);
		await harness.session.prompt("Write a file");
		const worktreePath = harness.session.cwd;
		git(harness.tempDir, "worktree", "remove", "--force", worktreePath);
		expect(existsSync(worktreePath)).toBe(false);

		const resumed = await createHarness({ sessionManager: harness.sessionManager });
		harnesses.push(resumed);

		expect(resumed.session.cwd).toBe(worktreePath);
		expect(existsSync(worktreePath)).toBe(true);
		expect(resumed.session.systemPrompt).toContain(worktreePath);
	});
});

describe("slugify", () => {
	it.each([
		["Tool group: compact lines!", Number.POSITIVE_INFINITY, "tool-group-compact-lines"],
		["Почини   сборку проекта сегодня вечером", 4, "pochini-sborku-proekta-segodnya"],
		["Café naïve", Number.POSITIVE_INFINITY, "cafe-naive"],
		["!!!", Number.POSITIVE_INFINITY, ""],
		["a".repeat(60), Number.POSITIVE_INFINITY, "a".repeat(40)],
	])("slugifies %s", (text, maxWords, expected) => {
		expect(slugify(text, maxWords)).toBe(expected);
	});
});
