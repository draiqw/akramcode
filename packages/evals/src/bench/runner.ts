/**
 * Executes one benchmark run: fresh workspace, isolated agent dir and HOME, headless agent, then
 * hidden acceptance tests.
 */

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createMetrics, metricsFromJsonl, type RunMetrics } from "./metrics.ts";
import { HIDDEN_DIR_NAME, type PlannedRun, type SettingsObject, type TaskSpec } from "./tasks.ts";

export interface RunOptions {
	command: string[];
	provider: string;
	model: string;
	thinking: string | undefined;
	settings: SettingsObject;
	authFile: string;
	/** Directory for this run's artifacts (events, stderr, test output, result). */
	artifactDir: string;
	keepWorkspace: boolean;
	timeoutScale: number;
}

export interface RunResult {
	runId: string;
	instanceId: string;
	taskId: string;
	variant: string | null;
	category: string;
	language: string;
	arm: string;
	rep: number;
	startedAt: string;
	/** Agent wall time in milliseconds (excludes setup and grading). */
	wallMs: number;
	agentExitCode: number | null;
	timedOut: boolean;
	pass: boolean;
	testExitCode: number | null;
	testTimedOut: boolean;
	filesChanged: number;
	metrics: RunMetrics;
	/** Harness-level failure (setup, spawn, grading infrastructure), distinct from a failed task. */
	harnessError: string | null;
	workspace: string | null;
}

interface ProcessOutcome {
	exitCode: number | null;
	timedOut: boolean;
	wallMs: number;
}

const GIT_IDENTITY = ["-c", "user.name=bench", "-c", "user.email=bench@example.invalid", "-c", "commit.gpgsign=false"];

function git(cwd: string, args: string[]): string {
	return execFileSync("git", [...GIT_IDENTITY, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const activeChildren = new Set<ChildProcess>();

/** Kills every running agent and test process (used on SIGINT). */
export function killAllRuns(): void {
	for (const child of activeChildren) killTree(child);
}

function killTree(child: ChildProcess): void {
	if (child.pid === undefined) return;
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		child.kill("SIGKILL");
	}
}

/** Runs a process in its own process group with stdin from /dev/null and a hard timeout. */
function runProcess(
	argv: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; stdoutPath: string; stderrPath: string; timeoutMs: number },
): Promise<ProcessOutcome> {
	return new Promise((resolvePromise, reject) => {
		const started = performance.now();
		const stdout = createWriteStream(options.stdoutPath);
		const stderr = createWriteStream(options.stderrPath);
		const child = spawn(argv[0], argv.slice(1), {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
		activeChildren.add(child);
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			killTree(child);
		}, options.timeoutMs);
		child.stdout.pipe(stdout);
		child.stderr.pipe(stderr);
		child.on("error", (error) => {
			activeChildren.delete(child);
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			activeChildren.delete(child);
			clearTimeout(timer);
			const wallMs = performance.now() - started;
			let pending = 2;
			const done = () => {
				if (--pending === 0) resolvePromise({ exitCode: code, timedOut, wallMs });
			};
			stdout.end(done);
			stderr.end(done);
		});
	});
}

/** Skips Python bytecode caches left in task dirs by local test runs. */
const notCache = (source: string): boolean => basename(source) !== "__pycache__" && !source.endsWith(".pyc");

/** Copies the fixture, runs the optional setup script, and commits the result as the baseline. */
export async function prepareWorkspace(task: TaskSpec, workspace: string): Promise<void> {
	await cp(join(task.dir, "repo"), workspace, { recursive: true, filter: notCache });
	const setup = join(task.dir, "setup", "setup.py");
	if (existsSync(setup)) {
		execFileSync("python3", [setup], { cwd: workspace, stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
	}
	git(workspace, ["init", "-q", "-b", "main"]);
	git(workspace, ["add", "-A"]);
	git(workspace, ["commit", "-q", "-m", "fixture"]);
}

export function countChangedFiles(workspace: string): number {
	try {
		git(workspace, ["add", "-A"]);
		const output = git(workspace, ["diff", "--cached", "--name-only", "HEAD"]);
		return output.split("\n").filter((line) => line.trim()).length;
	} catch {
		return 0;
	}
}

export interface GradeResult {
	pass: boolean;
	exitCode: number | null;
	timedOut: boolean;
}

/** Copies hidden tests into the workspace (replacing anything the agent left there) and runs them. */
export async function gradeWorkspace(
	task: TaskSpec,
	workspace: string,
	outputPath: string,
	env: NodeJS.ProcessEnv,
): Promise<GradeResult> {
	const hidden = join(workspace, HIDDEN_DIR_NAME);
	await rm(hidden, { recursive: true, force: true });
	await cp(join(task.dir, "hidden"), hidden, { recursive: true, filter: notCache });
	const outcome = await runProcess(task.test, {
		cwd: workspace,
		env,
		stdoutPath: outputPath,
		stderrPath: `${outputPath}.stderr`,
		timeoutMs: 180_000,
	});
	return { pass: outcome.exitCode === 0 && !outcome.timedOut, exitCode: outcome.exitCode, timedOut: outcome.timedOut };
}

/** Environment for the agent and the tests: isolated HOME and agent dir, no inherited agent config. */
export function isolatedEnv(home: string, agentDir: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	const passthrough = ["PATH", "LANG", "LC_ALL", "TERM", "TMPDIR", "SHELL", "USER", "LOGNAME"];
	passthrough.push("HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy");
	passthrough.push("SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS");
	for (const key of passthrough) {
		if (process.env[key] !== undefined) env[key] = process.env[key];
	}
	env.HOME = home;
	env.AKRAMCODE_CODING_AGENT_DIR = agentDir;
	env.AKRAMCODE_SKIP_VERSION_CHECK = "1";
	env.PYTHONDONTWRITEBYTECODE = "1";
	env.NO_COLOR = "1";
	return env;
}

interface AuthJson {
	[provider: string]: { expires?: number } | undefined;
}

let authWriteBack: Promise<void> = Promise.resolve();

/**
 * OAuth refresh tokens rotate: if one run refreshes the token, copies held by other runs go stale.
 * After each run, copy a newer token back to the shared auth file so later runs start from it.
 * Encrypted text is copied back only when the shared file's key exists: a key the run created
 * itself is deleted with the run, and the shared file would become unreadable.
 */
export function syncAuthBack(runAuth: string, sharedAuth: string): Promise<void> {
	authWriteBack = authWriteBack.then(async () => {
		try {
			const [mine, shared] = await Promise.all([readFile(runAuth, "utf8"), readFile(sharedAuth, "utf8")]);
			const mineJson = JSON.parse(mine) as AuthJson;
			const sharedJson = JSON.parse(shared) as AuthJson;
			const newer = Object.keys(mineJson).some(
				(provider) => (mineJson[provider]?.expires ?? 0) > (sharedJson[provider]?.expires ?? 0),
			);
			const readable =
				!mine.includes("enc:v1:") ||
				!!process.env.AKRAMCODE_SECRETS_KEY ||
				existsSync(join(dirname(sharedAuth), "secrets.key"));
			if (newer && readable) await writeFile(sharedAuth, mine, { mode: 0o600 });
		} catch {}
	});
	return authWriteBack;
}

export async function executeRun(run: PlannedRun, options: RunOptions): Promise<RunResult> {
	const task = run.instance.task;
	const root = await mkdtemp(join(tmpdir(), "akc-bench-"));
	const workspace = join(root, "ws");
	const agentDir = join(root, "agent");
	const home = join(root, "home");
	const result: RunResult = {
		runId: run.runId,
		instanceId: run.instance.instanceId,
		taskId: task.id,
		variant: run.instance.variant ?? null,
		category: task.category,
		language: task.language,
		arm: run.arm,
		rep: run.rep,
		startedAt: new Date().toISOString(),
		wallMs: 0,
		agentExitCode: null,
		timedOut: false,
		pass: false,
		testExitCode: null,
		testTimedOut: false,
		filesChanged: 0,
		metrics: createMetrics(),
		harnessError: null,
		workspace: options.keepWorkspace ? workspace : null,
	};
	await mkdir(options.artifactDir, { recursive: true });
	const eventsPath = join(options.artifactDir, "events.jsonl");
	try {
		await mkdir(agentDir, { recursive: true });
		await mkdir(home, { recursive: true });
		await cp(options.authFile, join(agentDir, "auth.json"));
		// Encrypted auth.json files are unreadable without the key that sits next to them.
		const secretsKey = join(dirname(options.authFile), "secrets.key");
		if (existsSync(secretsKey)) await cp(secretsKey, join(agentDir, "secrets.key"));
		await writeFile(join(agentDir, "settings.json"), `${JSON.stringify(options.settings, null, "\t")}\n`);
		await writeFile(join(options.artifactDir, "settings.json"), `${JSON.stringify(options.settings, null, "\t")}\n`);
		await prepareWorkspace(task, workspace);

		const env = isolatedEnv(home, agentDir);
		const argv = [
			...options.command,
			"-p",
			task.prompt,
			"--mode",
			"json",
			"--provider",
			options.provider,
			"--model",
			options.model,
		];
		if (options.thinking) argv.push("--thinking", options.thinking);
		// The agent needs the key of an encrypted auth.json; the task tests do not.
		const secretsKeyEnv = process.env.AKRAMCODE_SECRETS_KEY;
		const outcome = await runProcess(argv, {
			cwd: workspace,
			env: secretsKeyEnv ? { ...env, AKRAMCODE_SECRETS_KEY: secretsKeyEnv } : env,
			stdoutPath: eventsPath,
			stderrPath: join(options.artifactDir, "stderr.txt"),
			timeoutMs: task.timeoutSec * 1000 * options.timeoutScale,
		});
		result.wallMs = Math.round(outcome.wallMs);
		result.agentExitCode = outcome.exitCode;
		result.timedOut = outcome.timedOut;
		result.metrics = metricsFromJsonl(await readFile(eventsPath, "utf8"));
		await syncAuthBack(join(agentDir, "auth.json"), options.authFile);

		result.filesChanged = countChangedFiles(workspace);
		const grade = await gradeWorkspace(task, workspace, join(options.artifactDir, "test-output.txt"), env);
		result.pass = grade.pass;
		result.testExitCode = grade.exitCode;
		result.testTimedOut = grade.timedOut;
	} catch (error) {
		result.harnessError = error instanceof Error ? error.message : String(error);
	} finally {
		await writeFile(join(options.artifactDir, "result.json"), `${JSON.stringify(result, null, "\t")}\n`);
		if (!options.keepWorkspace) await rm(root, { recursive: true, force: true });
	}
	return result;
}

export interface VerifyResult {
	instanceId: string;
	failsBefore: boolean;
	passesAfter: boolean | null;
	error: string | null;
}

/**
 * Self-check of a task: the hidden tests must fail on the untouched fixture and pass once the
 * reference solution (`solution/files/` overlay, then optional `solution/apply.py`) is applied.
 */
export async function verifyTask(task: TaskSpec): Promise<VerifyResult> {
	const root = await mkdtemp(join(tmpdir(), "akc-bench-verify-"));
	const result: VerifyResult = { instanceId: task.id, failsBefore: false, passesAfter: null, error: null };
	try {
		const workspace = join(root, "ws");
		const home = join(root, "home");
		await mkdir(home);
		const env = isolatedEnv(home, join(root, "agent"));
		await prepareWorkspace(task, workspace);
		const before = await gradeWorkspace(task, workspace, join(root, "before.txt"), env);
		result.failsBefore = !before.pass;
		const solution = join(task.dir, "solution");
		if (existsSync(solution)) {
			const files = join(solution, "files");
			if (existsSync(files) && (await stat(files)).isDirectory()) {
				await cp(files, workspace, { recursive: true, filter: notCache });
			}
			const apply = join(solution, "apply.py");
			if (existsSync(apply)) {
				execFileSync("python3", [apply], {
					cwd: workspace,
					env: { ...env, TASK_DIR: task.dir },
					stdio: ["ignore", "pipe", "pipe"],
					timeout: 120_000,
				});
			}
			const after = await gradeWorkspace(task, workspace, join(root, "after.txt"), env);
			result.passesAfter = after.pass;
			if (!after.pass) result.error = (await readFile(join(root, "after.txt"), "utf8")).slice(-2000);
		}
	} catch (error) {
		result.error = error instanceof Error ? error.message : String(error);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
	return result;
}
