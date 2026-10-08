import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentSession } from "../../src/core/sdk.ts";
import { DEFAULT_TOOL_NAMES } from "../../src/core/settings-manager.ts";
import { collectAgentWarnings, showAgents } from "../../src/extensions/tasks/agents.ts";
import { createHarness, createTestUiContext, type Harness } from "./harness.ts";

type SelectAnswer = (title: string, options: string[]) => string | undefined;

/** A UI whose dialogs answer from scripted queues. */
function scriptedUi(script: {
	select: SelectAnswer[];
	input: Array<string | undefined>;
	editor?: Array<string | undefined>;
	custom?: unknown[];
	confirm?: boolean[];
}) {
	const titles: string[] = [];
	const notifications: string[] = [];
	return {
		titles,
		notifications,
		ui: createTestUiContext({
			select: async (title, options) => {
				titles.push(title);
				const answer = script.select.shift();
				if (!answer) throw new Error(`Unexpected select: ${title}`);
				return answer(title, options);
			},
			input: async () => script.input.shift(),
			editor: async () => script.editor?.shift(),
			confirm: async () => script.confirm?.shift() ?? false,
			custom: async <T>() => script.custom?.shift() as T,
			notify: (message) => {
				notifications.push(message);
			},
		}),
	};
}

const pick =
	(prefix: string): SelectAnswer =>
	(_title, options) => {
		const option = options.find((candidate) => candidate.startsWith(prefix));
		if (!option) throw new Error(`No option starting with ${prefix}: ${options.join(" | ")}`);
		return option;
	};
const close: SelectAnswer = () => undefined;

describe("/agents", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("creates an agent with picked tools that is usable at once, and deletes it", async () => {
		const harness = await createHarness({
			createSubagentSession: createAgentSession,
			initialActiveToolNames: [...DEFAULT_TOOL_NAMES],
		});
		harnesses.push(harness);
		const create = scriptedUi({
			select: [pick("+ Create new agent"), pick("User ("), pick("low"), close],
			input: ["reviewer", "Reviews diffs for bugs", ""],
			custom: [["read", "grep"]],
			editor: ["Review the diff. Report bugs only."],
		});
		await harness.session.bindExtensions({ uiContext: create.ui, mode: "tui" });

		await showAgents(harness.session.extensionRunner.createCommandContext());

		const path = join(harness.tempDir, "agent", "agents", "reviewer.md");
		expect(create.notifications).toEqual([`Created agent "reviewer" at ${path}`]);
		expect(readFileSync(path, "utf-8")).toBe(
			'---\nname: reviewer\ndescription: "Reviews diffs for bugs"\ntools: read, grep\nthinking: low\n---\n\nReview the diff. Report bugs only.\n',
		);
		const reviewer = harness.session.subagents?.listTypes().types.find((type) => type.name === "reviewer");
		expect(reviewer).toMatchObject({ tools: ["read", "grep"], thinking: "low", source: "user" });
		expect(harness.session.agent.state.tools.find((tool) => tool.name === "agent")?.description).toContain(
			"\n- reviewer: Reviews diffs for bugs",
		);

		const remove = scriptedUi({
			select: [pick("reviewer (user)"), pick("Delete"), close],
			input: [],
			confirm: [true],
		});
		await harness.session.bindExtensions({ uiContext: remove.ui, mode: "tui" });
		await showAgents(harness.session.extensionRunner.createCommandContext());

		// grep is not active in the session, so the agent does not get it.
		expect(remove.titles[1]).toContain("Tools: read\n");
		expect(remove.titles[1]).toContain("Warning: no tool matches grep");
		expect(existsSync(path)).toBe(false);
		expect(harness.session.subagents?.listTypes().types.map((type) => type.name)).toEqual([
			"general-purpose",
			"explore",
		]);
	});

	it("does not warn about optional tools of built-in agent types", async () => {
		const harness = await createHarness({
			createSubagentSession: createAgentSession,
			initialActiveToolNames: [...DEFAULT_TOOL_NAMES],
		});
		harnesses.push(harness);
		const control = harness.session.subagents;
		if (!control) throw new Error("subagents are not enabled");
		// grep, find, and ls are off by default; explore lists them, so it would warn on every start.
		expect(control.resolveTools(control.listTypes().types.find((type) => type.name === "explore")!).unknown).toEqual(
			expect.arrayContaining(["grep"]),
		);
		expect(collectAgentWarnings(control)).toEqual([]);
	});

	it("rejects invalid names and existing files without writing", async () => {
		const harness = await createHarness({
			createSubagentSession: createAgentSession,
			initialActiveToolNames: [...DEFAULT_TOOL_NAMES],
		});
		harnesses.push(harness);
		const run = scriptedUi({
			select: [pick("+ Create new agent"), pick("User ("), close],
			input: ["bad name!"],
		});
		await harness.session.bindExtensions({ uiContext: run.ui, mode: "tui" });
		await showAgents(harness.session.extensionRunner.createCommandContext());
		expect(run.notifications).toEqual(["Agent names use letters, digits, `-`, `_`, and `.`"]);
	});
});
