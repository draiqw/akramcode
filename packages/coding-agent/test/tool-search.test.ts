import type { AgentTool } from "@akramcode/agent-core";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type { ExtensionToolContext, SkillInfo, ToolInfo, ToolNamespace } from "../src/core/extensions/types.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { createCodemodeDescription } from "../src/extensions/codemode/tool.ts";
import {
	Bm25Ranker,
	createToolSearchDocument,
	createToolSearchToolDefinition,
	formatToolSearchResults,
	tokenize,
} from "../src/extensions/tool-search/tool.ts";

function tool(name: string, description: string, properties: Record<string, unknown> = {}): AgentTool {
	return {
		name,
		label: name,
		description,
		parameters: Type.Unsafe({ type: "object", properties }),
		execute: async () => ({ content: [], details: undefined }),
	};
}

describe("tokenize", () => {
	it("splits camelCase and snake_case, drops stop words, and folds plurals", () => {
		expect(tokenize("listIssues for the GitHub_repo")).toEqual(["list", "issue", "git", "hub", "repo"]);
		expect(tokenize("searches queries HTTPServer")).toEqual(["search", "query", "http", "server"]);
	});
});

describe("Bm25Ranker", () => {
	const tools = [
		tool("mcp__github__list_issues", "List issues in a repository.", {
			state: { type: "string", description: "open or closed" },
		}),
		tool("mcp__github__create_pull_request", "Open a pull request."),
		tool("mcp__linear__search_issues", "Search Linear issues by text."),
		tool("mcp__docs__search", "Search the documentation."),
	];
	const documents = tools.map((entry) => createToolSearchDocument(entry));

	it("ranks by term relevance and respects the limit", () => {
		const ranker = new Bm25Ranker();
		expect(ranker.rank("issue", documents, 8).map((match) => match.name)).toEqual([
			"mcp__linear__search_issues",
			"mcp__github__list_issues",
		]);
		expect(ranker.rank("pull requests", documents, 8)[0].name).toBe("mcp__github__create_pull_request");
		expect(ranker.rank("search", documents, 1)).toHaveLength(1);
		// Property names and descriptions are searchable.
		expect(ranker.rank("closed", documents, 8).map((match) => match.name)).toEqual(["mcp__github__list_issues"]);
	});

	it("returns nothing for unknown or empty queries", () => {
		const ranker = new Bm25Ranker();
		expect(ranker.rank("kubernetes", documents, 8)).toEqual([]);
		expect(ranker.rank("the", documents, 8)).toEqual([]);
		// Known v1 limit: no synonyms, so "tickets" does not find "issues".
		expect(ranker.rank("tickets", documents, 8)).toEqual([]);
	});

	it("includes the namespace in the search text", () => {
		const document = createToolSearchDocument(tool("mcp__x__run", "Run it."), {
			name: "mcp__x",
			description: "Kubernetes cluster tools",
		});
		expect(new Bm25Ranker().rank("kubernetes", [document], 8)).toEqual([
			{ name: "mcp__x__run", score: expect.any(Number) },
		]);
	});
});

describe("codemode description catalog", () => {
	const plain = tool("read_notes", "Read notes.");
	const github = ["a", "b", "c"].map((suffix) => tool(`mcp__github__${suffix}`, `GitHub ${suffix}.`));
	const docs = [tool("mcp__docs__search", "Search docs."), tool("mcp__docs__long", "Long ".repeat(200))];
	const all = [plain, ...github, ...docs];
	const namespaces = new Map<string, ToolNamespace>([
		...github.map((entry) => [entry.name, { name: "mcp__github", description: "GitHub server" }] as const),
		...docs.map((entry) => [entry.name, { name: "mcp__docs" }] as const),
	]);

	it("lists everything without a budget", () => {
		const description = createCodemodeDescription(all, { namespaces });
		expect(description).toContain("Nested tools:");
		expect(description).toContain("## mcp__github\nGitHub server");
		expect(description).toContain("## mcp__docs\n\n### `mcp__docs");
		// The search guidance is always there, so tools that appear later do not change it.
		expect(description).toContain("find unlisted tools, such as MCP tools");
	});

	it("fills the budget round-robin, cheapest first, and says what is missing", () => {
		// Each small section costs about 42 tokens: one tool per group, then one more.
		const description = createCodemodeDescription(all, { namespaces, inlineBudget: 170 });
		expect(description).toContain("### `read_notes`");
		expect(description).toContain("## mcp__docs (some tools not listed)");
		expect(description).toContain("### `mcp__docs__search`");
		expect(description).not.toContain("### `mcp__docs__long`");
		expect(description).toContain("## mcp__github (some tools not listed)");
		expect(description).toContain("find unlisted tools, such as MCP tools");
		// Deterministic: the same input gives the same description.
		expect(createCodemodeDescription(all, { namespaces, inlineBudget: 170 })).toBe(description);
	});

	it("leaves deferred tools and their namespaces out entirely", () => {
		const deferred = new Set(github.map((entry) => entry.name));
		const description = createCodemodeDescription(all, { namespaces, deferred });
		expect(description).not.toContain("mcp__github");
		// Deferred tools, such as those of a server that connects later, do not change the description.
		expect(description).toBe(createCodemodeDescription([plain, ...docs], { namespaces }));
	});

	it("leaves namespace instructions out", () => {
		const description = createCodemodeDescription(github, {
			namespaces: new Map(
				github.map((entry) => [entry.name, { name: "mcp__github", instructions: "Long usage guide." }] as const),
			),
		});
		expect(description).toContain("## mcp__github\n\n### `mcp__github__a`");
		expect(description).not.toContain("Long usage guide.");
	});

	it("lists only namespaces with a zero budget", () => {
		const description = createCodemodeDescription(all, { namespaces, inlineBudget: 0 });
		expect(description).toContain("## mcp__docs (tools not listed)");
		expect(description).not.toContain("codemode tool declaration:");
	});
});

describe("tool_search with skills", () => {
	const deferred = (entry: AgentTool): ToolInfo => ({
		name: entry.name,
		description: entry.description,
		parameters: entry.parameters,
		exposure: "deferred",
		sourceInfo: createSyntheticSourceInfo("<test>", { source: "test" }),
	});
	const allTools = [
		deferred(tool("mcp__pdf__merge", "Merge PDF files.")),
		deferred(tool("mcp__github__list_issues", "List issues in a repository.")),
	];
	const skills: SkillInfo[] = [
		{
			name: "pdf-tools",
			description: "Extract text and tables from PDF files.\nMore details.",
			filePath: "/skills/pdf-tools/SKILL.md",
			disableModelInvocation: false,
		},
		{
			name: "pdf-secret",
			description: "Internal PDF workflow.",
			filePath: "/skills/pdf-secret/SKILL.md",
			disableModelInvocation: true,
		},
	];

	async function search(query: string, limit?: number) {
		let active: string[] = [];
		const definition = createToolSearchToolDefinition({
			tools: {
				getAllTools: () => allTools,
				getActiveTools: () => active,
				setActiveTools: (names) => {
					active = names;
				},
			},
			skills: { getSkills: () => skills },
		});
		const result = await definition.execute(
			"call-1",
			{ query, limit },
			undefined,
			undefined,
			{} as ExtensionToolContext,
		);
		const content = result.content[0];
		return { text: content.type === "text" ? content.text : "", details: result.details, active };
	}

	it("ranks skills and tools in one list and loads only the tools", async () => {
		const { text, details, active } = await search("pdf");
		expect(details).toEqual({ loaded: ["mcp__pdf__merge"], skills: ["pdf-tools"] });
		// The skill is returned, not activated.
		expect(active).toEqual(["mcp__pdf__merge"]);
		expect(text).toBe(
			[
				"Loaded 1 tool. They are available from your next call. To use a skill, read its file:",
				"- mcp__pdf__merge: Merge PDF files.",
				"- skill:pdf-tools: Extract text and tables from PDF files. (/skills/pdf-tools/SKILL.md)",
			].join("\n"),
		);
	});

	it("excludes skills with disableModelInvocation", async () => {
		const { details } = await search("internal workflow");
		expect(details).toEqual({ loaded: [], skills: [] });
	});

	it("returns skill-only matches without loading anything", async () => {
		const { text, active } = await search("extract tables");
		expect(active).toEqual([]);
		expect(text).toBe(
			"To use a skill, read its file:\n- skill:pdf-tools: Extract text and tables from PDF files. (/skills/pdf-tools/SKILL.md)",
		);
	});

	it("applies the limit across tools and skills", async () => {
		const { details } = await search("pdf", 1);
		expect(details.loaded.length + details.skills.length).toBe(1);
	});

	it("keeps the tool-only format and reports no matches", () => {
		expect(formatToolSearchResults([{ kind: "tool", name: "a", description: "A tool.\nMore." }])).toBe(
			"Loaded 1 tool. They are available from your next call:\n- a: A tool.",
		);
		expect(formatToolSearchResults([])).toBe("No matching tools or skills found.");
	});
});
