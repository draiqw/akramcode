/**
 * A/B quality benchmark for akramcode builds and settings.
 *
 *   node src/bench/cli.ts list
 *   node src/bench/cli.ts verify-tasks [--tasks <patterns>]
 *   node src/bench/cli.ts run --arm base=release:v1.0.9 --arm cand=source:../.. [options]
 *   node src/bench/cli.ts report <results dir>
 *
 * See bench/README.md.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBuild } from "./builds.ts";
import { type ArmSpec, parseBuildSpec, parseNamedValue, settingsForRun } from "./config.ts";
import { formatMarkdown, type ReportMeta, summarize } from "./report.ts";
import { executeRun, killAllRuns, type RunResult, verifyTask } from "./runner.ts";
import { median } from "./stats.ts";
import {
	expandInstances,
	filterInstances,
	loadTasks,
	type PlannedRun,
	planRuns,
	type SettingsObject,
} from "./tasks.ts";

const EVALS_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TASKS_ROOT = join(EVALS_ROOT, "bench", "tasks");
const PRESETS_ROOT = join(EVALS_ROOT, "bench", "settings");
const STATE_ROOT = join(EVALS_ROOT, ".bench");

interface CliOptions {
	command: string;
	positional: string[];
	arms: string[];
	settings: string[];
	tasks: string[];
	variants: boolean;
	reps: number;
	concurrency: number;
	provider: string;
	model: string;
	thinking: string | undefined;
	auth: string;
	contextWindow: number;
	out: string | undefined;
	resume: boolean;
	keepWorkspaces: boolean;
	dryRun: boolean;
	timeoutScale: number;
	margin: number;
	releaseRepo: string;
	seed: number;
}

const USAGE = `Usage: node src/bench/cli.ts <command> [options]

Commands:
  list                         List task instances
  verify-tasks                 Check every task: hidden tests fail on the fixture, pass with the solution
  run                          Run the benchmark
  report <dir>                 Rebuild report.md and summary.json from <dir>/results.jsonl

Run options:
  --arm <name>=<build>         Repeatable; the first arm is the baseline.
                               Builds: release:<tag> | binary:<path> | source:<dir> | ref:<git ref>
  --settings <name>=<v>        Settings overlay for an arm: JSON file, preset name in bench/settings, or inline JSON
  --tasks <patterns>           Comma-separated instance ids, prefixes ending in *, or categories
  --no-variants                Skip task variants such as <id>@compact
  --reps <n>                   Repetitions per (instance, arm) (default 3)
  --concurrency <n>            Parallel runs (default 2)
  --provider <id>              Default openai-codex
  --model <id>                 Default gpt-6-luna
  --thinking <level>           Passed to --thinking
  --auth <file>                auth.json copied into each isolated agent dir (default /tmp/akc-def/auth.json)
  --context-window <n>         Window used by the $compactAtTokens macro (default 922000)
  --out <dir>                  Results dir (default packages/evals/.bench/results/<timestamp>)
  --resume                     Skip runs already recorded in <out>/results.jsonl
  --keep-workspaces            Keep temp workspaces for inspection
  --timeout-scale <x>          Multiply task timeouts (default 1)
  --margin <pp>                Non-inferiority margin in percentage points (default 10)
  --seed <n>                   Plan shuffle seed (default 1)
  --dry-run                    Print the plan and exit
`;

function parseArgs(argv: readonly string[]): CliOptions {
	const options: CliOptions = {
		command: argv[0] ?? "help",
		positional: [],
		arms: [],
		settings: [],
		tasks: [],
		variants: true,
		reps: 3,
		concurrency: 2,
		provider: "openai-codex",
		model: "gpt-6-luna",
		thinking: undefined,
		auth: "/tmp/akc-def/auth.json",
		contextWindow: 922_000,
		out: undefined,
		resume: false,
		keepWorkspaces: false,
		dryRun: false,
		timeoutScale: 1,
		margin: 10,
		releaseRepo: "draiqw/akramcode",
		seed: 1,
	};
	const positiveNumber = (name: string, value: string): number => {
		const parsed = Number(value);
		if (!(parsed > 0) || !Number.isFinite(parsed)) throw new Error(`${name} expects a positive number`);
		return parsed;
	};
	for (let index = 1; index < argv.length; index++) {
		const argument = argv[index];
		const equals = argument.startsWith("--") ? argument.indexOf("=") : -1;
		const name = equals === -1 ? argument : argument.slice(0, equals);
		const takeValue = (): string => {
			if (equals !== -1) return argument.slice(equals + 1);
			const value = argv[++index];
			if (value === undefined) throw new Error(`Missing value for ${name}`);
			return value;
		};
		switch (name) {
			case "--arm":
				options.arms.push(takeValue());
				break;
			case "--settings":
				options.settings.push(takeValue());
				break;
			case "--tasks":
				options.tasks.push(
					...takeValue()
						.split(",")
						.map((part) => part.trim())
						.filter(Boolean),
				);
				break;
			case "--no-variants":
				options.variants = false;
				break;
			case "--reps":
				options.reps = Math.floor(positiveNumber(name, takeValue()));
				break;
			case "--concurrency":
				options.concurrency = Math.floor(positiveNumber(name, takeValue()));
				break;
			case "--provider":
				options.provider = takeValue();
				break;
			case "--model":
				options.model = takeValue();
				break;
			case "--thinking":
				options.thinking = takeValue();
				break;
			case "--auth":
				options.auth = resolve(takeValue());
				break;
			case "--context-window":
				options.contextWindow = Math.floor(positiveNumber(name, takeValue()));
				break;
			case "--out":
				options.out = resolve(takeValue());
				break;
			case "--resume":
				options.resume = true;
				break;
			case "--keep-workspaces":
				options.keepWorkspaces = true;
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			case "--timeout-scale":
				options.timeoutScale = positiveNumber(name, takeValue());
				break;
			case "--margin":
				options.margin = positiveNumber(name, takeValue());
				break;
			case "--release-repo":
				options.releaseRepo = takeValue();
				break;
			case "--seed":
				options.seed = Math.floor(positiveNumber(name, takeValue()));
				break;
			default:
				if (argument.startsWith("-")) throw new Error(`Unknown option ${argument}`);
				options.positional.push(argument);
		}
	}
	return options;
}

function loadSettingsValue(value: string): SettingsObject {
	let text: string;
	if (value.trimStart().startsWith("{")) text = value;
	else if (existsSync(resolve(value))) text = readFileSync(resolve(value), "utf8");
	else if (existsSync(join(PRESETS_ROOT, `${value}.json`)))
		text = readFileSync(join(PRESETS_ROOT, `${value}.json`), "utf8");
	else throw new Error(`Settings "${value}" is not inline JSON, a file, or a preset in ${PRESETS_ROOT}`);
	const parsed: unknown = JSON.parse(text);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`Settings "${value}" must be a JSON object`);
	}
	return parsed as SettingsObject;
}

function parseArms(options: CliOptions): ArmSpec[] {
	if (options.arms.length === 0) throw new Error("At least one --arm is required");
	const arms = options.arms.map((text) => {
		const { name, value } = parseNamedValue(text, "--arm");
		return { name, build: parseBuildSpec(value), buildText: value, settings: {} as SettingsObject };
	});
	for (const text of options.settings) {
		const { name, value } = parseNamedValue(text, "--settings");
		const arm = arms.find((candidate) => candidate.name === name);
		if (!arm) throw new Error(`--settings refers to unknown arm "${name}"`);
		arm.settings = loadSettingsValue(value);
	}
	return arms;
}

function repoRoot(): string {
	return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: EVALS_ROOT, encoding: "utf8" }).trim();
}

async function readResults(dir: string): Promise<RunResult[]> {
	const path = join(dir, "results.jsonl");
	if (!existsSync(path)) return [];
	return (await readFile(path, "utf8"))
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as RunResult);
}

async function writeReport(dir: string, meta: ReportMeta, results: RunResult[]): Promise<string> {
	const summary = summarize(results, meta);
	await writeFile(join(dir, "summary.json"), `${JSON.stringify(summary, null, "\t")}\n`);
	const markdown = formatMarkdown(summary, results);
	await writeFile(join(dir, "report.md"), markdown);
	return markdown;
}

function formatProgress(done: number, total: number, result: RunResult): string {
	const status = result.harnessError ? "HARNESS-ERROR" : result.pass ? "PASS" : result.timedOut ? "TIMEOUT" : "FAIL";
	const metrics = result.metrics;
	const parts = [
		`[${done}/${total}]`,
		result.runId,
		status,
		`${(result.wallMs / 1000).toFixed(1)}s`,
		`${Math.round(metrics.usage.total / 1000)}k tok`,
		`$${metrics.usage.cost.toFixed(4)}`,
		`turns=${metrics.turns}`,
		`tools=${metrics.toolCalls}`,
	];
	if (metrics.compactions > 0) parts.push(`compactions=${metrics.compactions}`);
	if (metrics.toolResultClears > 0) parts.push(`clears=${metrics.toolResultClears}`);
	if (result.harnessError) parts.push(result.harnessError.slice(0, 200));
	return parts.join(" ");
}

async function commandRun(options: CliOptions): Promise<void> {
	const tasks = loadTasks(TASKS_ROOT);
	const instances = filterInstances(expandInstances(tasks, options.variants), options.tasks);
	const arms = parseArms(options);
	const plan = planRuns(
		instances,
		arms.map((arm) => arm.name),
		options.reps,
		options.seed,
	);
	for (const arm of arms) settingsForRun(arm.settings, {}, options.contextWindow);
	console.log(
		`${instances.length} task instances x ${arms.length} arms x ${options.reps} reps = ${plan.length} runs, concurrency ${options.concurrency}`,
	);
	if (options.dryRun) {
		for (const run of plan) console.log(`  ${run.runId}`);
		return;
	}
	if (!existsSync(options.auth)) throw new Error(`Auth file not found: ${options.auth}`);

	const context = {
		cacheDir: join(STATE_ROOT, "cache"),
		repoRoot: repoRoot(),
		releaseRepo: options.releaseRepo,
		log: (message: string) => console.log(message),
	};
	const commands = new Map<string, string[]>();
	const armInfo = arms.map((arm) => {
		const build = resolveBuild(arm.build, context);
		commands.set(arm.name, build.command);
		console.log(`arm ${arm.name}: ${build.label}`);
		return { name: arm.name, build: build.label, settings: arm.settings };
	});

	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const out = options.out ?? join(STATE_ROOT, "results", stamp);
	await mkdir(out, { recursive: true });
	const meta: ReportMeta = {
		createdAt: new Date().toISOString(),
		provider: options.provider,
		model: options.model,
		reps: options.reps,
		instances: instances.map((instance) => instance.instanceId),
		arms: armInfo,
		nonInferiorityMargin: options.margin / 100,
	};
	await writeFile(join(out, "meta.json"), `${JSON.stringify(meta, null, "\t")}\n`);

	const previous = options.resume ? await readResults(out) : [];
	const completed = new Set(previous.filter((result) => result.harnessError === null).map((result) => result.runId));
	const results = previous.filter((result) => completed.has(result.runId));
	const pending = plan.filter((run) => !completed.has(run.runId));
	if (options.resume) {
		await writeFile(join(out, "results.jsonl"), results.map((result) => `${JSON.stringify(result)}\n`).join(""));
	}
	console.log(`results: ${out}${completed.size > 0 ? ` (resuming, ${completed.size} runs already done)` : ""}`);

	let interrupted = false;
	process.on("SIGINT", () => {
		if (interrupted) process.exit(130);
		interrupted = true;
		console.log("\ninterrupted: killing running agents; partial results stay in results.jsonl (use --resume)");
		killAllRuns();
	});

	let next = 0;
	let done = 0;
	const armsByName = new Map(arms.map((arm) => [arm.name, arm]));
	const worker = async () => {
		while (!interrupted && next < pending.length) {
			const run: PlannedRun = pending[next++];
			const arm = armsByName.get(run.arm)!;
			const result = await executeRun(run, {
				command: commands.get(run.arm)!,
				provider: options.provider,
				model: options.model,
				thinking: options.thinking,
				settings: settingsForRun(arm.settings, run.instance.settings, options.contextWindow),
				authFile: options.auth,
				artifactDir: join(out, "runs", run.runId),
				keepWorkspace: options.keepWorkspaces,
				timeoutScale: options.timeoutScale,
			});
			if (interrupted) return;
			results.push(result);
			await appendFile(join(out, "results.jsonl"), `${JSON.stringify(result)}\n`);
			console.log(formatProgress(++done, pending.length, result));
		}
	};
	const started = performance.now();
	await Promise.all(Array.from({ length: Math.min(options.concurrency, pending.length) }, worker));
	const elapsed = (performance.now() - started) / 1000;

	const markdown = await writeReport(out, meta, results);
	console.log(`\n${markdown}`);
	const costs = results.map((result) => result.metrics.usage.cost);
	console.log(
		`elapsed ${(elapsed / 60).toFixed(1)} min for ${done} runs; median run cost $${(median(costs) ?? 0).toFixed(4)}`,
	);
	console.log(`report: ${join(out, "report.md")}`);
	if (interrupted) process.exitCode = 130;
}

async function commandReport(options: CliOptions): Promise<void> {
	const dir = options.positional[0];
	if (!dir) throw new Error("report needs a results directory");
	const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as ReportMeta;
	console.log(await writeReport(dir, meta, await readResults(dir)));
}

async function commandVerify(options: CliOptions): Promise<void> {
	const instances = filterInstances(expandInstances(loadTasks(TASKS_ROOT), false), options.tasks);
	let failures = 0;
	const results = await Promise.all(instances.map((instance) => verifyTask(instance.task)));
	for (const result of results) {
		const ok = result.failsBefore && result.passesAfter === true;
		if (!ok) failures++;
		const after = result.passesAfter === null ? "no solution" : result.passesAfter ? "passes" : "FAILS";
		console.log(
			`${ok ? "ok  " : "BAD "} ${result.instanceId}: fixture ${result.failsBefore ? "fails" : "PASSES"}, solution ${after}`,
		);
		if (!ok && result.error) console.log(result.error.replace(/^/gm, "     "));
	}
	if (failures > 0) process.exitCode = 1;
}

function commandList(options: CliOptions): void {
	const instances = filterInstances(expandInstances(loadTasks(TASKS_ROOT), options.variants), options.tasks);
	for (const instance of instances) {
		const task = instance.task;
		console.log(
			`${instance.instanceId.padEnd(40)} ${task.category.padEnd(14)} ${task.language.padEnd(11)} ${task.title}`,
		);
	}
	console.log(`${instances.length} instances`);
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	switch (options.command) {
		case "run":
			return commandRun(options);
		case "report":
			return commandReport(options);
		case "verify-tasks":
			return commandVerify(options);
		case "list":
			return commandList(options);
		default:
			console.log(USAGE);
			if (options.command !== "help" && options.command !== "--help") process.exitCode = 2;
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
