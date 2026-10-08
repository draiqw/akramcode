import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionToolContext } from "../src/core/extensions/types.ts";
import {
	formatTaskFinishedNotification,
	formatTaskOutputNotification,
	readTaskOutputTail,
} from "../src/core/tasks/notifications.ts";
import { type TaskEvent, type TaskInfo, TaskRegistry } from "../src/core/tasks/task-registry.ts";
import { createLineBatcher, createTaskStopToolDefinition } from "../src/core/tasks/task-tools.ts";
import { createBashToolDefinition } from "../src/core/tools/bash.ts";

function waitForFinished(
	tasks: TaskRegistry,
	id: string,
	timeoutMs = 10_000,
): Promise<{ task: TaskInfo; notify: boolean }> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Task ${id} did not finish`)), timeoutMs);
		const unsubscribe = tasks.subscribe((event) => {
			if (event.type === "finished" && event.task.id === id) {
				clearTimeout(timer);
				unsubscribe();
				resolve({ task: event.task, notify: event.notify });
			}
		});
	});
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content.map((part) => part.text ?? "").join("");
}

const noContext = undefined as unknown as ExtensionToolContext;

describe("TaskRegistry", () => {
	let dir: string;
	let tasks: TaskRegistry;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "akramcode-tasks-test-"));
		tasks = new TaskRegistry({ parentDir: dir });
	});

	afterEach(() => {
		tasks.stopAll();
		rmSync(dir, { recursive: true, force: true });
	});

	it("assigns ids per kind and tracks status, output, and events", async () => {
		const events: TaskEvent["type"][] = [];
		tasks.subscribe((event) => events.push(event.type));
		const bash = tasks.create({ kind: "bash", description: "npm test", command: "npm test" });
		const agent = tasks.create({ kind: "agent", description: "find code", agentType: "explore" });
		const secondBash = tasks.create({ kind: "bash", description: "ls" });
		expect([bash.id, agent.id, secondBash.id]).toEqual(["b1", "a1", "b2"]);
		expect(tasks.running().map((task) => task.id)).toEqual(["b1", "a1", "b2"]);

		bash.write("line 1\n");
		bash.write(Buffer.from("line 2\n"));
		await bash.finish({ status: "completed", exitCode: 0 });
		expect(readFileSync(bash.outputFile, "utf-8")).toBe("line 1\nline 2\n");
		expect(tasks.get("b1")).toMatchObject({ status: "completed", exitCode: 0, command: "npm test" });
		expect(tasks.get("b1")?.endedAt).toBeGreaterThanOrEqual(tasks.get("b1")?.startedAt ?? 0);

		agent.update({
			usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: 0, turns: 1, toolUses: 4 },
		});
		expect(tasks.get("a1")?.usage?.toolUses).toBe(4);
		expect(events).toEqual(["started", "started", "started", "finished", "updated"]);
	});

	it("finishes stopped tasks as stopped and suppresses notifications on request", async () => {
		const quiet = tasks.create({ kind: "bash", description: "sleep" });
		const loud = tasks.create({ kind: "bash", description: "sleep" });
		const quietFinished = waitForFinished(tasks, quiet.id);
		const loudFinished = waitForFinished(tasks, loud.id);
		expect(tasks.stop(quiet.id, { notify: false })).toBe(true);
		expect(tasks.stop(loud.id)).toBe(true);
		expect(quiet.signal.aborted).toBe(true);
		// The runner reports a failure after the kill; the registry keeps "stopped".
		await quiet.finish({ status: "failed", error: "aborted" });
		await loud.finish({ status: "failed", error: "aborted" });
		expect(await quietFinished).toMatchObject({ task: { status: "stopped" }, notify: false });
		expect(await loudFinished).toMatchObject({ task: { status: "stopped" }, notify: true });
		expect(tasks.get(quiet.id)?.error).toBeUndefined();
		expect(tasks.stop(quiet.id)).toBe(false);
		expect(tasks.stop("missing")).toBe(false);
	});

	it("stopAll stops every running task without notifications", async () => {
		const first = tasks.create({ kind: "monitor", description: "watch" });
		const finished = waitForFinished(tasks, first.id);
		tasks.stopAll();
		await first.finish({ status: "completed" });
		expect(await finished).toMatchObject({ notify: false, task: { status: "stopped" } });
	});

	it("waitForActivity resolves on output events and on timeout", async () => {
		const monitor = tasks.create({ kind: "monitor", description: "watch" });
		const waiting = tasks.waitForActivity(10_000);
		monitor.emitOutput(["hello"]);
		await waiting;
		const started = Date.now();
		await tasks.waitForActivity(20);
		expect(Date.now() - started).toBeGreaterThanOrEqual(15);
	});
});

describe("task notifications", () => {
	it("carries the bash output tail, exit code, and output file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "akramcode-tasks-test-"));
		try {
			const tasks = new TaskRegistry({ parentDir: dir });
			const handle = tasks.create({ kind: "bash", description: "make", command: "make" });
			handle.write(`${Array.from({ length: 30 }, (_, i) => `out ${i}`).join("\n")}\n`);
			await handle.finish({ status: "failed", exitCode: 2 });
			const text = formatTaskFinishedNotification(tasks.get(handle.id) as TaskInfo);
			expect(text).toContain("<task-id>b1</task-id>");
			expect(text).toContain("<status>failed</status>");
			expect(text).toContain('Background command "make" failed with exit code 2');
			expect(text).toContain("out 29");
			expect(text).toContain("out 10");
			expect(text).not.toContain("out 9\n");
			expect(text).toContain(`<output-file>${handle.outputFile}</output-file>`);
			expect(readTaskOutputTail(handle.outputFile, 2)).toEqual(["out 28", "out 29"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("carries the result of agents and the lines of monitors", () => {
		const task: TaskInfo = {
			id: "a1",
			kind: "agent",
			description: "find code",
			status: "completed",
			startedAt: 0,
			endedAt: 1000,
			outputFile: "/tmp/a1.output",
			result: "Found it in src/index.ts",
		};
		expect(formatTaskFinishedNotification(task)).toContain("<result>\nFound it in src/index.ts\n</result>");
		const monitor: TaskInfo = { ...task, id: "m1", kind: "monitor", status: "running", result: undefined };
		const text = formatTaskOutputNotification(monitor, ["ERROR one", "ERROR two"], 5);
		expect(text).toContain("ERROR one\nERROR two\n[5 more lines in /tmp/a1.output]");
	});
});

describe("background bash", () => {
	let dir: string;
	let tasks: TaskRegistry;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "akramcode-bash-bg-test-"));
		tasks = new TaskRegistry({ parentDir: dir });
	});

	afterEach(() => {
		tasks.stopAll();
		rmSync(dir, { recursive: true, force: true });
	});

	it("offers run_in_background only with a task registry", () => {
		const plain = createBashToolDefinition(dir);
		const background = createBashToolDefinition(dir, { backgroundTasks: tasks });
		expect(Object.keys(plain.parameters.properties)).not.toContain("run_in_background");
		expect(Object.keys(background.parameters.properties)).toContain("run_in_background");
	});

	it("returns at once and streams output to the task file until the command exits", async () => {
		const bash = createBashToolDefinition(dir, { backgroundTasks: tasks });
		const started = Date.now();
		const result = await bash.execute(
			"call-1",
			{ command: "sleep 0.3; echo background-done", run_in_background: true },
			undefined,
			undefined,
			noContext,
		);
		expect(Date.now() - started).toBeLessThan(300);
		expect(result.details?.taskId).toBe("b1");
		expect(textOf(result)).toContain("Command running in background with ID: b1");
		expect(tasks.get("b1")?.status).toBe("running");

		const { task, notify } = await waitForFinished(tasks, "b1");
		expect(notify).toBe(true);
		expect(task).toMatchObject({ status: "completed", exitCode: 0 });
		expect(readFileSync(task.outputFile, "utf-8")).toBe("background-done\n");
	});

	it("reports a non-zero exit code as failed", async () => {
		const bash = createBashToolDefinition(dir, { backgroundTasks: tasks });
		await bash.execute(
			"call-1",
			{ command: "echo oops; exit 3", run_in_background: true },
			undefined,
			undefined,
			noContext,
		);
		const { task } = await waitForFinished(tasks, "b1");
		expect(task).toMatchObject({ status: "failed", exitCode: 3 });
	});

	it("is killed by task_stop without a notification", async () => {
		const bash = createBashToolDefinition(dir, { backgroundTasks: tasks });
		const marker = join(dir, "marker");
		await bash.execute(
			"call-1",
			{ command: `sleep 1; touch ${marker}`, run_in_background: true },
			undefined,
			undefined,
			noContext,
		);
		const finished = waitForFinished(tasks, "b1");
		const stop = createTaskStopToolDefinition(tasks);
		const result = await stop.execute("call-2", { task_id: "b1" }, undefined, undefined, noContext);
		expect(textOf(result)).toContain("Stopped task b1");
		expect(await finished).toMatchObject({ task: { status: "stopped" }, notify: false });
		await new Promise((resolve) => setTimeout(resolve, 1300));
		expect(existsSync(marker)).toBe(false);
		await expect(stop.execute("call-3", { task_id: "b1" }, undefined, undefined, noContext)).rejects.toThrow(
			"is not running",
		);
		await expect(stop.execute("call-4", { task_id: "b9" }, undefined, undefined, noContext)).rejects.toThrow(
			"No task with id b9",
		);
	});
});

describe("bash monitor mode", () => {
	let dir: string;
	let tasks: TaskRegistry;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "akramcode-monitor-test-"));
		tasks = new TaskRegistry({ parentDir: dir });
	});

	afterEach(() => {
		tasks.stopAll();
		rmSync(dir, { recursive: true, force: true });
	});

	it("delivers output lines in rate-limited batches until the command exits", async () => {
		const outputs: Array<{ lines: string[]; omitted: number; at: number }> = [];
		tasks.subscribe((event) => {
			if (event.type === "output") outputs.push({ lines: event.lines, omitted: event.omittedLines, at: Date.now() });
		});
		const bash = createBashToolDefinition(dir, {
			backgroundTasks: tasks,
			monitorBatching: { batchWindowMs: 50, minIntervalMs: 300, maxLinesPerEvent: 3 },
		});
		const result = await bash.execute(
			"call-1",
			{
				command: "for i in 1 2 3 4 5; do echo line$i; done; sleep 0.1; echo late; sleep 0.1; printf tail",
				run_in_background: true,
				monitor: true,
			},
			undefined,
			undefined,
			noContext,
		);
		expect(textOf(result)).toContain("Monitor m1 started (timeout 300s)");
		const { task } = await waitForFinished(tasks, "m1");
		expect(task).toMatchObject({ kind: "monitor", status: "completed", exitCode: 0 });
		expect(outputs[0]).toMatchObject({ lines: ["line1", "line2", "line3"], omitted: 2 });
		expect(outputs.slice(1).flatMap((output) => output.lines)).toEqual(["late", "tail"]);
		if (outputs.length > 2) expect(outputs[1].at - outputs[0].at).toBeGreaterThanOrEqual(250);
		expect(readFileSync(task.outputFile, "utf-8")).toBe("line1\nline2\nline3\nline4\nline5\nlate\ntail");
	});

	it("counts lines past the batch limit instead of keeping them", () => {
		const batches: Array<{ lines: string[]; omitted: number }> = [];
		const batcher = createLineBatcher({
			deliver: (lines, omitted) => batches.push({ lines, omitted }),
			maxLinesPerEvent: 2,
		});
		batcher.push(Buffer.from("y\n".repeat(100_000)));
		batcher.push(Buffer.from("x".repeat(10_000)));
		batcher.flush();
		expect(batches).toHaveLength(1);
		expect(batches[0]).toEqual({ lines: ["y", "y"], omitted: 99_999 });
	});

	it("stops at the timeout and requires run_in_background", async () => {
		const bash = createBashToolDefinition(dir, { backgroundTasks: tasks });
		await bash.execute(
			"call-1",
			{ command: "sleep 5", timeout: 0.2, run_in_background: true, monitor: true },
			undefined,
			undefined,
			noContext,
		);
		const { task } = await waitForFinished(tasks, "m1");
		expect(task.status).toBe("completed");
		expect(task.result).toContain("Stopped watching after 0.2 seconds");
		await expect(
			bash.execute("call-2", { command: "true", monitor: true }, undefined, undefined, noContext),
		).rejects.toThrow("monitor requires run_in_background");
	});

	it("runs background and monitor commands through the bash spawn pipeline", async () => {
		const seen: string[] = [];
		const bash = createBashToolDefinition(dir, {
			backgroundTasks: tasks,
			commandPrefix: "PREFIX=from-prefix",
			spawnHook: (context) => {
				seen.push(context.command);
				return { ...context, env: { ...context.env, HOOKED: "from-hook" } };
			},
		});
		await bash.execute(
			"call-1",
			{ command: 'echo "$PREFIX $HOOKED"', run_in_background: true },
			undefined,
			undefined,
			noContext,
		);
		await bash.execute(
			"call-2",
			{ command: 'echo "$PREFIX $HOOKED"', run_in_background: true, monitor: true },
			undefined,
			undefined,
			noContext,
		);
		const [background, monitor] = await Promise.all([waitForFinished(tasks, "b1"), waitForFinished(tasks, "m1")]);
		expect(seen).toEqual([
			'PREFIX=from-prefix\necho "$PREFIX $HOOKED"',
			'PREFIX=from-prefix\necho "$PREFIX $HOOKED"',
		]);
		expect(readFileSync(background.task.outputFile, "utf-8")).toBe("from-prefix from-hook\n");
		expect(readFileSync(monitor.task.outputFile, "utf-8")).toBe("from-prefix from-hook\n");
	});
});

describe("task output files", () => {
	it("live in a private, unpredictable directory with private files that are removed on dispose", async () => {
		const parent = mkdtempSync(join(tmpdir(), "akramcode-tasks-perm-"));
		try {
			const tasks = new TaskRegistry({ parentDir: parent });
			const handle = tasks.create({ kind: "bash", description: "x" });
			handle.write("secret\n");
			await handle.finish({ status: "completed", exitCode: 0 });
			const [dirName] = readdirSync(parent);
			expect(dirName).toMatch(/^akramcode-tasks-.{6}$/);
			const outputDir = join(parent, dirName);
			expect(handle.outputFile.startsWith(outputDir)).toBe(true);
			if (process.platform !== "win32") {
				expect(statSync(outputDir).mode & 0o777).toBe(0o700);
				expect(statSync(handle.outputFile).mode & 0o777).toBe(0o600);
			}
			tasks.dispose();
			expect(existsSync(outputDir)).toBe(false);
		} finally {
			rmSync(parent, { recursive: true, force: true });
		}
	});

	it("stop at the size limit and drop output the disk cannot keep up with", async () => {
		const parent = mkdtempSync(join(tmpdir(), "akramcode-tasks-cap-"));
		try {
			const tasks = new TaskRegistry({ parentDir: parent, maxOutputBytes: 100 });
			const capped = tasks.create({ kind: "bash", description: "x" });
			for (let i = 0; i < 20; i++) {
				capped.write("0123456789\n");
				// Let the stream drain so only the size limit applies.
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			await capped.finish({ status: "completed" });
			const cappedText = readFileSync(capped.outputFile, "utf-8");
			expect(cappedText.startsWith("0123456789\n".repeat(9))).toBe(true);
			expect(cappedText).toContain("[Output limit of 100 bytes reached");
			expect(cappedText.match(/0123456789/g)).toHaveLength(9);

			// Synchronous writes outrun the stream: past 64 buffered bytes, chunks are dropped, not buffered.
			const fastTasks = new TaskRegistry({ parentDir: parent, maxBufferedBytes: 64 });
			const flooded = fastTasks.create({ kind: "bash", description: "y" });
			for (let i = 0; i < 20; i++) flooded.write("abcdefghi\n");
			await new Promise((resolve) => setTimeout(resolve, 50));
			flooded.write("after\n");
			await flooded.finish({ status: "completed" });
			const floodedText = readFileSync(flooded.outputFile, "utf-8");
			expect(floodedText).toMatch(/\[\d+ bytes dropped: output arrived faster than it could be written\]\nafter\n$/);
			expect(floodedText.length).toBeLessThan(200);
			tasks.dispose();
			fastTasks.dispose();
		} finally {
			rmSync(parent, { recursive: true, force: true });
		}
	});

	it("keep memory and the output file bounded for a command that prints without pause", async () => {
		const parent = mkdtempSync(join(tmpdir(), "akramcode-tasks-yes-"));
		try {
			const tasks = new TaskRegistry({ parentDir: parent, maxOutputBytes: 1024 * 1024 });
			const bash = createBashToolDefinition(parent, { backgroundTasks: tasks });
			await bash.execute("call-1", { command: "yes", run_in_background: true }, undefined, undefined, noContext);
			await new Promise((resolve) => setTimeout(resolve, 500));
			const finished = waitForFinished(tasks, "b1", 5000);
			const stoppedAt = Date.now();
			tasks.stop("b1");
			const { task } = await finished;
			expect(Date.now() - stoppedAt).toBeLessThan(3000);
			const size = statSync(task.outputFile).size;
			await new Promise((resolve) => setTimeout(resolve, 200));
			expect(statSync(task.outputFile).size).toBe(size);
			expect(size).toBeLessThan(1024 * 1024 + 1024);
			tasks.dispose();
		} finally {
			rmSync(parent, { recursive: true, force: true });
		}
	});

	it("does not follow a symlink planted at the output path", async () => {
		const parent = mkdtempSync(join(tmpdir(), "akramcode-tasks-link-"));
		try {
			const tasks = new TaskRegistry({ parentDir: parent });
			const first = tasks.create({ kind: "bash", description: "x" });
			await first.finish({ status: "completed" });
			// Plant a symlink where the next task's output file goes.
			const target = join(parent, "target.txt");
			writeFileSync(target, "original");
			const nextPath = first.outputFile.replace(/b1\.output$/, "b2.output");
			symlinkSync(target, nextPath);
			const second = tasks.create({ kind: "bash", description: "y" });
			second.write("attacker-controlled\n");
			await second.finish({ status: "completed" });
			expect(readFileSync(target, "utf-8")).toBe("original");
			expect(lstatSync(nextPath).isSymbolicLink()).toBe(true);
			tasks.dispose();
		} finally {
			rmSync(parent, { recursive: true, force: true });
		}
	});
});
