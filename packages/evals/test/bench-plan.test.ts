import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mergeSettings, parseBuildSpec, parseNamedValue, settingsForRun } from "../src/bench/config.ts";
import {
	expandInstances,
	filterInstances,
	loadTasks,
	parseTaskSpec,
	planRuns,
	type TaskSpec,
} from "../src/bench/tasks.ts";

const TASKS_ROOT = join(fileURLToPath(new URL("..", import.meta.url)), "bench", "tasks");

function task(id: string, variants: TaskSpec["variants"] = {}): TaskSpec {
	return {
		id,
		title: id,
		category: "bugfix",
		language: "python",
		prompt: "fix it",
		test: ["true"],
		timeoutSec: 60,
		variants,
		dir: `/tasks/${id}`,
	};
}

describe("parseTaskSpec", () => {
	const valid = { id: "a-b", title: "T", category: "long", language: "python", prompt: "Do it", test: ["x"] };

	it("applies defaults", () => {
		expect(parseTaskSpec(valid, "/t")).toMatchObject({ timeoutSec: 600, variants: {} });
	});

	it("rejects invalid specs and prompts that leak the grader", () => {
		expect(() => parseTaskSpec({ ...valid, category: "other" }, "/t")).toThrow("category");
		expect(() => parseTaskSpec({ ...valid, test: [] }, "/t")).toThrow("test");
		expect(() => parseTaskSpec({ ...valid, prompt: "the hidden tests check" }, "/t")).toThrow("hidden");
		expect(() => parseTaskSpec({ ...valid, variants: { x: {} } }, "/t")).toThrow("settings");
	});
});

describe("task set", () => {
	it("loads every task in bench/tasks", () => {
		const tasks = loadTasks(TASKS_ROOT);
		expect(tasks.length).toBeGreaterThanOrEqual(15);
		const long = tasks.filter((spec) => spec.category === "long");
		expect(long.length).toBeGreaterThanOrEqual(4);
		for (const spec of long) expect(spec.variants.compact).toBeDefined();
		expect(new Set(tasks.map((spec) => spec.language))).toEqual(new Set(["python", "typescript"]));
	});
});

describe("instances", () => {
	const tasks = [task("a"), task("b", { compact: { settings: { $compactAtTokens: 1000 } } })];

	it("expands variants", () => {
		expect(expandInstances(tasks, true).map((instance) => instance.instanceId)).toEqual(["a", "b", "b@compact"]);
		expect(expandInstances(tasks, false).map((instance) => instance.instanceId)).toEqual(["a", "b"]);
	});

	it("filters by id, prefix, and category", () => {
		const instances = expandInstances(tasks, true);
		expect(filterInstances(instances, ["b*"]).map((instance) => instance.instanceId)).toEqual(["b", "b@compact"]);
		expect(filterInstances(instances, ["bugfix"])).toHaveLength(3);
		expect(() => filterInstances(instances, ["zzz"])).toThrow("No task matches");
	});
});

describe("planRuns", () => {
	const instances = expandInstances([task("a"), task("b"), task("c")], false);

	it("plans every instance, arm, and repetition once", () => {
		const plan = planRuns(instances, ["base", "cand"], 3);
		expect(plan).toHaveLength(18);
		expect(new Set(plan.map((run) => run.runId)).size).toBe(18);
	});

	it("interleaves arms and balances which arm goes first", () => {
		const plan = planRuns(instances, ["base", "cand"], 2);
		for (let i = 0; i < plan.length; i += 2) {
			expect(plan[i].instance).toBe(plan[i + 1].instance);
			expect(new Set([plan[i].arm, plan[i + 1].arm])).toEqual(new Set(["base", "cand"]));
		}
		const firsts = plan.filter((_, index) => index % 2 === 0).map((run) => run.arm);
		expect(firsts.filter((arm) => arm === "base")).toHaveLength(3);
	});

	it("is deterministic per seed", () => {
		const ids = (seed: number) => planRuns(instances, ["x"], 2, seed).map((run) => run.runId);
		expect(ids(5)).toEqual(ids(5));
		expect(() => planRuns(instances, ["x", "x"], 1)).toThrow("unique");
	});
});

describe("settings", () => {
	it("deep merges objects and replaces arrays", () => {
		expect(
			mergeSettings(
				{ compaction: { enabled: true, keep: 1 }, defaultTools: ["a"] },
				{ compaction: { keep: 2 }, defaultTools: ["b"] },
			),
		).toEqual({ compaction: { enabled: true, keep: 2 }, defaultTools: ["b"] });
	});

	it("resolves $compactAtTokens against the context window", () => {
		expect(settingsForRun({ compaction: { keepRecentTokens: 5000 } }, { $compactAtTokens: 30000 }, 100000)).toEqual({
			compaction: { keepRecentTokens: 5000, reserveTokens: 70000 },
		});
		expect(() => settingsForRun({}, { $compactAtTokens: 200000 }, 100000)).toThrow("below the context window");
		expect(() => settingsForRun({ $other: 1 }, {}, 100000)).toThrow("Unknown settings macro");
	});

	it("parses build specs and arm pairs", () => {
		expect(parseBuildSpec("release:v1.0.9")).toEqual({ kind: "release", tag: "v1.0.9" });
		expect(parseBuildSpec("source:.")).toEqual({ kind: "source", dir: "." });
		expect(() => parseBuildSpec("v1.0.9")).toThrow("Invalid build");
		expect(() => parseBuildSpec("svn:x")).toThrow("Unknown build kind");
		expect(parseNamedValue("base=ref:HEAD~1", "--arm")).toEqual({ name: "base", value: "ref:HEAD~1" });
		expect(() => parseNamedValue("=x", "--arm")).toThrow("--arm");
	});
});
