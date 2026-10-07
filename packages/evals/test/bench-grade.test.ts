import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countChangedFiles, gradeWorkspace, isolatedEnv, prepareWorkspace, verifyTask } from "../src/bench/runner.ts";
import type { TaskSpec } from "../src/bench/tasks.ts";

let root: string;
let task: TaskSpec;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "bench-grade-test-"));
	const dir = join(root, "task");
	await mkdir(join(dir, "repo"), { recursive: true });
	await mkdir(join(dir, "hidden"), { recursive: true });
	await mkdir(join(dir, "solution", "files"), { recursive: true });
	await writeFile(join(dir, "repo", "value.txt"), "1\n");
	await writeFile(join(dir, "solution", "files", "value.txt"), "2\n");
	// The hidden check passes only when value.txt contains 2.
	await writeFile(
		join(dir, "hidden", "check.mjs"),
		'import { readFileSync } from "node:fs";\nprocess.exit(readFileSync("value.txt", "utf8").trim() === "2" ? 0 : 1);\n',
	);
	task = {
		id: "tiny",
		title: "tiny",
		category: "bugfix",
		language: "typescript",
		prompt: "set value to 2",
		test: [process.execPath, "__hidden__/check.mjs"],
		timeoutSec: 30,
		variants: {},
		dir,
	};
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("grading", () => {
	it("grades with hidden tests copied over anything the agent left", async () => {
		const workspace = join(root, "ws");
		await prepareWorkspace(task, workspace);
		const env = isolatedEnv(join(root, "home"), join(root, "agent"));
		expect((await gradeWorkspace(task, workspace, join(root, "out1.txt"), env)).pass).toBe(false);

		await writeFile(join(workspace, "value.txt"), "2\n");
		await mkdir(join(workspace, "__hidden__"), { recursive: true });
		await writeFile(join(workspace, "__hidden__", "check.mjs"), "process.exit(1);\n");
		expect(countChangedFiles(workspace)).toBe(2);
		const grade = await gradeWorkspace(task, workspace, join(root, "out2.txt"), env);
		expect(grade).toEqual({ pass: true, exitCode: 0, timedOut: false });
		expect(await readFile(join(workspace, "__hidden__", "check.mjs"), "utf8")).toContain("readFileSync");
	});

	it("verifies fail-before and pass-after with the reference solution", async () => {
		expect(await verifyTask(task)).toEqual({ instanceId: "tiny", failsBefore: true, passesAfter: true, error: null });
	});
});
