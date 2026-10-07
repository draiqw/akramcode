/**
 * Task loading, variant expansion, and run planning.
 *
 * A task lives in `bench/tasks/<id>/`:
 * - `task.json`: prompt, hidden-test command, timeout, optional settings variants
 * - `repo/`: fixture copied into a fresh workspace
 * - `hidden/`: acceptance tests, copied to `<workspace>/__hidden__/` only after the agent exits
 * - `setup/setup.py` (optional): generates bulky content in the workspace before the agent starts
 * - `solution/` (optional): reference solution used by `verify-tasks`, never shown to the agent
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRng } from "./stats.ts";

export const TASK_CATEGORIES = ["bugfix", "feature", "refactor", "comprehension", "long"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export type SettingsObject = Record<string, unknown>;

export interface TaskSpec {
	id: string;
	title: string;
	category: TaskCategory;
	language: "python" | "typescript";
	prompt: string;
	test: string[];
	timeoutSec: number;
	variants: Record<string, { settings: SettingsObject }>;
	dir: string;
}

/** A task, or one of its settings variants. Variant instances are named `<id>@<variant>`. */
export interface TaskInstance {
	instanceId: string;
	task: TaskSpec;
	variant: string | undefined;
	settings: SettingsObject;
}

export const HIDDEN_DIR_NAME = "__hidden__";

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTaskSpec(raw: unknown, dir: string): TaskSpec {
	const where = `${dir}/task.json`;
	if (!isObject(raw)) throw new TypeError(`${where}: expected an object`);
	const { id, title, category, language, prompt, test, timeoutSec, variants } = raw;
	if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new TypeError(`${where}: invalid id`);
	if (typeof title !== "string" || !title) throw new TypeError(`${where}: missing title`);
	if (typeof category !== "string" || !(TASK_CATEGORIES as readonly string[]).includes(category)) {
		throw new TypeError(`${where}: invalid category`);
	}
	if (language !== "python" && language !== "typescript") throw new TypeError(`${where}: invalid language`);
	if (typeof prompt !== "string" || !prompt.trim()) throw new TypeError(`${where}: missing prompt`);
	if (/hidden test|__hidden__/i.test(prompt)) throw new TypeError(`${where}: prompt must not mention hidden tests`);
	if (!Array.isArray(test) || test.length === 0 || !test.every((part) => typeof part === "string")) {
		throw new TypeError(`${where}: test must be a non-empty string array`);
	}
	const timeout = timeoutSec ?? 600;
	if (typeof timeout !== "number" || !(timeout > 0)) throw new TypeError(`${where}: invalid timeoutSec`);
	const parsedVariants: Record<string, { settings: SettingsObject }> = {};
	if (variants !== undefined) {
		if (!isObject(variants)) throw new TypeError(`${where}: variants must be an object`);
		for (const [name, variant] of Object.entries(variants)) {
			if (!/^[a-z0-9-]+$/.test(name)) throw new TypeError(`${where}: invalid variant name ${name}`);
			if (!isObject(variant) || !isObject(variant.settings)) {
				throw new TypeError(`${where}: variant ${name} needs a settings object`);
			}
			parsedVariants[name] = { settings: variant.settings };
		}
	}
	return {
		id,
		title,
		category: category as TaskCategory,
		language,
		prompt,
		test: test as string[],
		timeoutSec: timeout,
		variants: parsedVariants,
		dir,
	};
}

export function loadTasks(tasksRoot: string): TaskSpec[] {
	const tasks: TaskSpec[] = [];
	for (const name of readdirSync(tasksRoot).sort()) {
		const dir = join(tasksRoot, name);
		if (!statSync(dir).isDirectory()) continue;
		const specPath = join(dir, "task.json");
		if (!existsSync(specPath)) continue;
		const spec = parseTaskSpec(JSON.parse(readFileSync(specPath, "utf8")), dir);
		if (spec.id !== name) throw new TypeError(`${specPath}: id ${spec.id} does not match directory ${name}`);
		for (const required of ["repo", "hidden"]) {
			if (!existsSync(join(dir, required))) throw new TypeError(`${dir}: missing ${required}/`);
		}
		tasks.push(spec);
	}
	return tasks;
}

export function expandInstances(tasks: readonly TaskSpec[], includeVariants: boolean): TaskInstance[] {
	const instances: TaskInstance[] = [];
	for (const task of tasks) {
		instances.push({ instanceId: task.id, task, variant: undefined, settings: {} });
		if (!includeVariants) continue;
		for (const [name, variant] of Object.entries(task.variants)) {
			instances.push({ instanceId: `${task.id}@${name}`, task, variant: name, settings: variant.settings });
		}
	}
	return instances;
}

/**
 * Selects instances by comma-separated patterns. A pattern matches an instance id exactly, or as a
 * prefix when it ends with `*`. `long` style category names select whole categories.
 */
export function filterInstances(instances: readonly TaskInstance[], patterns: readonly string[]): TaskInstance[] {
	if (patterns.length === 0) return [...instances];
	const matches = (instance: TaskInstance, pattern: string): boolean => {
		if (pattern.endsWith("*")) return instance.instanceId.startsWith(pattern.slice(0, -1));
		if ((TASK_CATEGORIES as readonly string[]).includes(pattern)) return instance.task.category === pattern;
		return instance.instanceId === pattern;
	};
	const selected = instances.filter((instance) => patterns.some((pattern) => matches(instance, pattern)));
	for (const pattern of patterns) {
		if (!instances.some((instance) => matches(instance, pattern))) {
			throw new Error(`No task matches "${pattern}"`);
		}
	}
	return selected;
}

export interface PlannedRun {
	runId: string;
	instance: TaskInstance;
	arm: string;
	rep: number;
}

/**
 * Plans every (instance, arm, repetition) run. Order is interleaved so that slow drifts in provider
 * latency or rate limits hit all arms alike: repetitions are outer, instances are shuffled per
 * repetition with a fixed seed, and the arm order rotates per (instance, repetition).
 */
export function planRuns(
	instances: readonly TaskInstance[],
	arms: readonly string[],
	reps: number,
	seed = 1,
): PlannedRun[] {
	if (!Number.isSafeInteger(reps) || reps < 1) throw new RangeError("reps must be a positive integer");
	if (arms.length === 0) throw new RangeError("at least one arm is required");
	if (new Set(arms).size !== arms.length) throw new RangeError("arm names must be unique");
	const runs: PlannedRun[] = [];
	for (let rep = 1; rep <= reps; rep++) {
		const order = instances.map((_, index) => index);
		const rng = createRng(seed * 1000 + rep);
		for (let i = order.length - 1; i > 0; i--) {
			const j = Math.floor(rng() * (i + 1));
			[order[i], order[j]] = [order[j], order[i]];
		}
		for (const [position, index] of order.entries()) {
			const instance = instances[index];
			const offset = (position + rep - 1) % arms.length;
			for (let k = 0; k < arms.length; k++) {
				const arm = arms[(k + offset) % arms.length];
				runs.push({ runId: `${instance.instanceId}~${arm}~r${rep}`, instance, arm, rep });
			}
		}
	}
	return runs;
}
