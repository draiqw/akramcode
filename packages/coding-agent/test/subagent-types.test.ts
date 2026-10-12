import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeToolCall } from "../src/core/subagents/agent-tool.ts";
import {
	discoverAgentTypes,
	resolveAgentTypeTools,
	type SubagentToolCandidate,
	serializeAgentType,
} from "../src/core/subagents/agent-types.ts";
import { parseFrontmatter } from "../src/utils/frontmatter.ts";

const candidates: SubagentToolCandidate[] = [
	{ name: "read", active: true },
	{ name: "bash", active: true },
	{ name: "edit", active: true },
	{ name: "write", active: true },
	{ name: "grep", active: false },
	{ name: "find", active: false },
	{ name: "ls", active: false },
	{ name: "agent", active: true },
	{ name: "task_stop", active: true },
	{ name: "web_search", active: true },
	{ name: "mcp__github__issues", active: false },
	{ name: "mcp__github__pulls", active: false },
	{ name: "mcp__slack__post", active: false },
];

describe("agent type discovery", () => {
	let root: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "akramcode-agent-types-"));
		agentDir = join(root, "agent");
		cwd = join(root, "project");
		mkdirSync(join(agentDir, "agents"), { recursive: true });
		mkdirSync(join(cwd, ".akramcode", "agents"), { recursive: true });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function writeAgent(dir: string, file: string, content: string) {
		writeFileSync(join(dir, file), content);
	}

	it("lists the built-in types without definition files", () => {
		const { types, diagnostics } = discoverAgentTypes({ cwd, agentDir, projectTrusted: true });
		expect(types.map((type) => type.name)).toEqual(["general-purpose", "explore"]);
		expect(diagnostics).toEqual([]);
		expect(resolveAgentTypeTools(types[1], candidates).tools).toEqual(["read", "grep", "find", "ls", "bash"]);
	});

	it("loads user and project definitions, project ones only when the project is trusted", () => {
		writeAgent(
			join(agentDir, "agents"),
			"reviewer.md",
			"---\nname: reviewer\ndescription: Reviews diffs\ntools: read, grep\nmodel: openai/gpt-x\nthinking: high\n---\nReview carefully.\n",
		);
		writeAgent(
			join(cwd, ".akramcode", "agents"),
			"tester.md",
			"---\nname: tester\ndescription: Runs tests\ntools: [bash, read]\ndisallowedTools: [edit]\n---\nRun the tests.\n",
		);
		// A project definition cannot replace a user or built-in definition with the same name.
		writeAgent(
			join(cwd, ".akramcode", "agents"),
			"reviewer.md",
			"---\nname: reviewer\ndescription: Project reviewer\ntools: write\nmodel: inherit\n---\nProject rules.\n",
		);
		writeAgent(
			join(cwd, ".akramcode", "agents"),
			"explore.md",
			"---\nname: explore\ndescription: Not read-only\ntools: bash, write\n---\nWrite anything.\n",
		);
		writeAgent(join(agentDir, "agents"), "broken.md", "---\ndescription: no name\n---\nbody\n");
		writeAgent(join(agentDir, "agents"), "odd.md", "---\nname: odd\ndescription: x\nthinking: extreme\n---\nbody\n");
		writeAgent(join(agentDir, "agents"), "notes.txt", "---\nname: notes\ndescription: not markdown\n---\n");

		const untrusted = discoverAgentTypes({ cwd, agentDir, projectTrusted: false });
		expect(untrusted.types.map((type) => type.name)).toEqual(["general-purpose", "explore", "odd", "reviewer"]);
		expect(untrusted.types.find((type) => type.name === "reviewer")).toMatchObject({
			description: "Reviews diffs",
			tools: ["read", "grep"],
			model: "openai/gpt-x",
			thinking: "high",
			systemPrompt: "Review carefully.",
			source: "user",
		});
		expect(untrusted.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
			"Skipped: frontmatter needs a `name` of letters, digits, `-`, `_`, or `.`",
			'Unknown thinking level "extreme"; using the parent\'s level',
		]);

		const trusted = discoverAgentTypes({ cwd, agentDir, projectTrusted: true });
		expect(trusted.types.map((type) => type.name)).toEqual([
			"general-purpose",
			"explore",
			"odd",
			"reviewer",
			"tester",
		]);
		expect(trusted.types.find((type) => type.name === "reviewer")).toMatchObject({
			description: "Reviews diffs",
			source: "user",
		});
		expect(trusted.types.find((type) => type.name === "explore")?.source).toBe("builtin");
		expect(trusted.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
			"Skipped: frontmatter needs a `name` of letters, digits, `-`, `_`, or `.`",
			'Unknown thinking level "extreme"; using the parent\'s level',
			'Skipped: a project agent cannot replace the builtin agent "explore"',
			'Skipped: a project agent cannot replace the user agent "reviewer"',
		]);
		expect(trusted.types.find((type) => type.name === "tester")).toMatchObject({
			tools: ["bash", "read"],
			disallowedTools: ["edit"],
		});
	});

	it("lets a user definition replace a built-in type", () => {
		writeAgent(
			join(agentDir, "agents"),
			"explore.md",
			"---\nname: explore\ndescription: My explorer\ntools: read\n---\nMine.\n",
		);
		const explore = discoverAgentTypes({ cwd, agentDir, projectTrusted: false }).types.find(
			(type) => type.name === "explore",
		);
		expect(explore).toMatchObject({ description: "My explorer", tools: ["read"], source: "user" });
	});

	it("does not take a model for a type named after an Object.prototype member", () => {
		writeAgent(join(agentDir, "agents"), "toString.md", "---\nname: toString\ndescription: Odd name\n---\nBody.\n");
		const type = discoverAgentTypes({ cwd, agentDir, projectTrusted: false }).types.find(
			(candidate) => candidate.name === "toString",
		);
		expect(type?.model).toBeUndefined();
	});

	it("serializes definitions that discovery reads back", () => {
		const content = serializeAgentType({
			name: "reviewer",
			description: 'Reviews: "diffs", carefully',
			tools: ["read", "mcp__github__*"],
			disallowedTools: ["bash"],
			model: "openai/gpt-x",
			thinking: "low",
			systemPrompt: "Be strict.",
		});
		writeFileSync(join(agentDir, "agents", "reviewer.md"), content);
		expect(parseFrontmatter(content).body.trim()).toBe("Be strict.");
		const [type] = discoverAgentTypes({ cwd, agentDir, projectTrusted: false }).types.filter(
			(candidate) => candidate.source === "user",
		);
		expect(type).toMatchObject({
			name: "reviewer",
			description: 'Reviews: "diffs", carefully',
			tools: ["read", "mcp__github__*"],
			disallowedTools: ["bash"],
			model: "openai/gpt-x",
			thinking: "low",
			systemPrompt: "Be strict.",
		});
	});
});

describe("resolveAgentTypeTools", () => {
	it("gives the parent's active tools without a tool list", () => {
		expect(resolveAgentTypeTools({}, candidates)).toEqual({
			tools: ["read", "bash", "edit", "write", "web_search"],
			unknown: [],
		});
	});

	it("applies allowlists with wildcards and denylists, and reports unknown names", () => {
		expect(
			resolveAgentTypeTools(
				{ tools: ["read", "mcp__github__*", "nope", "agent"], disallowedTools: ["missing"] },
				candidates,
			),
		).toEqual({ tools: ["read", "mcp__github__issues", "mcp__github__pulls"], unknown: ["nope", "missing"] });
		expect(resolveAgentTypeTools({ disallowedTools: ["edit", "write", "mcp__*"] }, candidates).tools).toEqual([
			"read",
			"bash",
			"web_search",
		]);
		// Names that are not among the candidates (tools the parent cannot call) are never given.
		expect(resolveAgentTypeTools({ tools: ["update_plan", "codemode"] }, candidates)).toEqual({
			tools: [],
			unknown: ["update_plan", "codemode"],
		});
	});

	it("never gives agent or background-control tools", () => {
		expect(resolveAgentTypeTools({ tools: ["*"] }, candidates).tools).not.toEqual(expect.arrayContaining(["agent"]));
		const all = resolveAgentTypeTools({ tools: ["*"] }, candidates).tools;
		expect(all).not.toContain("task_stop");
		expect(all).toContain("mcp__slack__post");
	});
});

describe("describeToolCall", () => {
	it("summarizes subagent tool calls in one line", () => {
		expect(describeToolCall("bash", { command: "npm test" })).toBe("$ npm test");
		expect(describeToolCall("read", { path: "/repo/src/index.ts" })).toBe("read /repo/src/index.ts");
		expect(describeToolCall("grep", { pattern: "TODO", path: "src" })).toBe("grep /TODO/ in src");
		expect(describeToolCall("ls", {})).toBe("ls .");
		expect(describeToolCall("custom", { a: 1 })).toBe('custom {"a":1}');
	});
});
