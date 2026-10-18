/**
 * Tool discovery: a BM25 ranker over tool metadata, shared by `searchTools()` in codemode scripts and
 * the optional `tool_search` tool.
 *
 * `tool_search` searches tools that are not declared to
 * the model (`codemode` and `deferred` exposure) and loads the matches, so they are declared for the
 * next model call. Loading goes through the active tool set, so it is recorded in the transcript
 * like any other tool change and survives `/tree`, resume, and fork on that branch.
 *
 * It also ranks model-invocable skills in the same list. Skill matches are not loaded: the result
 * gives their SKILL.md path, which the model reads to use the skill.
 */

import { type Static, Type } from "typebox";
import type {
	ExtensionAPI,
	SkillInfo,
	ToolDefinition,
	ToolExposure,
	ToolInfo,
	ToolNamespace,
} from "../../core/extensions/types.ts";

export const TOOL_SEARCH_TOOL_NAME = "tool_search";
export const DEFAULT_TOOL_SEARCH_LIMIT = 8;

/** A tool as the ranker sees it: its name and the text built by {@link createToolSearchDocument}. */
export interface ToolSearchDocument {
	name: string;
	text: string;
}

export interface ToolSearchMatch {
	name: string;
	score: number;
}

/** Ranks tools for a query. BM25 today; a hybrid ranker with embeddings can replace it. */
export interface ToolRanker {
	rank(query: string, documents: readonly ToolSearchDocument[], limit: number): ToolSearchMatch[];
}

const STOP_WORDS: ReadonlySet<string> = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"in",
	"is",
	"it",
	"of",
	"on",
	"or",
	"that",
	"the",
	"this",
	"to",
	"with",
]);

/** Naive singular form, so `issues` matches `issue` and `searches` matches `search`. */
function stem(term: string): string {
	if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
	if (term.length > 4 && /(ches|shes|sses|xes|zes)$/.test(term)) return term.slice(0, -2);
	if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) return term.slice(0, -1);
	return term;
}

/** Lowercase terms, split at camelCase boundaries and non-alphanumerics, without stop words. */
export function tokenize(text: string): string[] {
	return text
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((term) => term.length > 0 && !STOP_WORDS.has(term))
		.map(stem);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Schema descriptions and property names, recursively. */
function schemaText(schema: unknown, parts: string[]): void {
	if (!isObject(schema)) return;
	if (typeof schema.description === "string") parts.push(schema.description);
	if (isObject(schema.properties)) {
		for (const [name, property] of Object.entries(schema.properties)) {
			parts.push(name);
			schemaText(property, parts);
		}
	}
	schemaText(schema.items, parts);
	for (const key of ["anyOf", "oneOf", "allOf"]) {
		const variants = schema[key];
		if (Array.isArray(variants)) for (const variant of variants) schemaText(variant, parts);
	}
}

/**
 * Search text of a tool: the name, the name with `_`
 * as spaces, the description, schema descriptions and property names, and the namespace with its
 * description and instructions.
 */
export function createToolSearchDocument(
	tool: Pick<ToolInfo, "name" | "description" | "parameters">,
	namespace?: ToolNamespace,
): ToolSearchDocument {
	const parts = [tool.name, tool.name.replaceAll("_", " "), tool.description];
	schemaText(tool.parameters, parts);
	if (namespace) parts.push(namespace.name, namespace.description ?? "", namespace.instructions ?? "");
	return { name: tool.name, text: parts.filter((part) => part.trim()).join(" ") };
}

/** Okapi BM25 with the usual parameters. Ties keep document order. */
export class Bm25Ranker implements ToolRanker {
	private readonly k1: number;
	private readonly b: number;

	constructor(options: { k1?: number; b?: number } = {}) {
		this.k1 = options.k1 ?? 1.2;
		this.b = options.b ?? 0.75;
	}

	rank(query: string, documents: readonly ToolSearchDocument[], limit: number): ToolSearchMatch[] {
		const queryTerms = [...new Set(tokenize(query))];
		if (queryTerms.length === 0 || documents.length === 0 || limit <= 0) return [];
		const termCounts = documents.map((document) => {
			const counts = new Map<string, number>();
			for (const term of tokenize(document.text)) counts.set(term, (counts.get(term) ?? 0) + 1);
			return counts;
		});
		const lengths = termCounts.map((counts) => [...counts.values()].reduce((sum, count) => sum + count, 0));
		const averageLength = lengths.reduce((sum, length) => sum + length, 0) / documents.length || 1;
		const idf = new Map(
			queryTerms.map((term) => {
				const frequency = termCounts.filter((counts) => counts.has(term)).length;
				return [term, Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5))] as const;
			}),
		);
		const matches: ToolSearchMatch[] = [];
		documents.forEach((document, index) => {
			let score = 0;
			for (const term of queryTerms) {
				const count = termCounts[index].get(term);
				if (!count) continue;
				const norm = this.k1 * (1 - this.b + (this.b * lengths[index]) / averageLength);
				score += (idf.get(term) ?? 0) * ((count * (this.k1 + 1)) / (count + norm));
			}
			if (score > 0) matches.push({ name: document.name, score });
		});
		return matches.sort((a, b) => b.score - a.score).slice(0, limit);
	}
}

export const toolSearchSchema = Type.Object({
	query: Type.String({ description: "Search query for deferred tools and skills." }),
	limit: Type.Optional(
		Type.Number({ description: `Maximum number of results. Defaults to ${DEFAULT_TOOL_SEARCH_LIMIT}.` }),
	),
});

export type ToolSearchInput = Static<typeof toolSearchSchema>;

/** Whether the tool is this `tool_search`, not another extension's tool of the same name. */
export function isToolSearchTool(tool: Pick<ToolInfo, "name" | "parameters">): boolean {
	return tool.name === TOOL_SEARCH_TOOL_NAME && tool.parameters === toolSearchSchema;
}

/** A ranked match: a tool, which is loaded, or a skill, which the model reads at `filePath`. */
export type ToolSearchResult =
	| { kind: "tool"; name: string; description: string }
	| { kind: "skill"; name: string; description: string; filePath: string };

export interface ToolSearchToolDetails {
	/** Tools loaded by this call. */
	loaded: string[];
	/** Skills found by this call. They are not loaded. */
	skills: string[];
}

export interface ToolSearchToolOptions {
	/**
	 * The session's tools. `tool_search` searches the tools that are not declared to the model and
	 * activates the matches. Without it, the tool finds nothing. An `ExtensionAPI` fits.
	 */
	tools?: Pick<ExtensionAPI, "getAllTools" | "getActiveTools" | "setActiveTools">;
	/**
	 * The session's skills. `tool_search` also ranks the skills without `disableModelInvocation`.
	 * An `ExtensionAPI` fits.
	 */
	skills?: Pick<ExtensionAPI, "getSkills">;
}

/** Prefix of skill document names, so a skill and a tool of the same name stay apart. */
const SKILL_PREFIX = "skill:";

/** Whether `tool_search` can load a tool with this exposure. */
function isSearchable(exposure: ToolExposure): boolean {
	return exposure === "codemode" || exposure === "deferred";
}

/**
 * Rank the searchable tools that are not active yet together with the model-invocable skills, and
 * activate the matching tools, so the next model call declares them. Activation is recorded in the
 * transcript like any tool change. Skills are only returned.
 */
function searchAndLoad(options: ToolSearchToolOptions, query: string, limit: number): ToolSearchResult[] {
	const active = options.tools?.getActiveTools() ?? [];
	const tools =
		options.tools?.getAllTools().filter((tool) => isSearchable(tool.exposure) && !active.includes(tool.name)) ?? [];
	const skills: SkillInfo[] = options.skills?.getSkills().filter((skill) => !skill.disableModelInvocation) ?? [];
	const documents = [
		...tools.map((tool) => createToolSearchDocument(tool, tool.namespace)),
		...skills.map((skill) => ({ name: `${SKILL_PREFIX}${skill.name}`, text: `${skill.name} ${skill.description}` })),
	];
	const results = new Bm25Ranker().rank(query, documents, limit).map((match): ToolSearchResult => {
		const skill = match.name.startsWith(SKILL_PREFIX)
			? skills.find((entry) => `${SKILL_PREFIX}${entry.name}` === match.name)
			: undefined;
		if (skill) return { kind: "skill", name: skill.name, description: skill.description, filePath: skill.filePath };
		return {
			kind: "tool",
			name: match.name,
			description: tools.find((tool) => tool.name === match.name)?.description ?? "",
		};
	});
	const loaded = results.filter((result) => result.kind === "tool").map((result) => result.name);
	if (loaded.length > 0) options.tools?.setActiveTools([...active, ...loaded]);
	return results;
}

/** The result text: the existing tool list, with skill lines and a hint when skills match. */
export function formatToolSearchResults(results: readonly ToolSearchResult[]): string {
	if (results.length === 0) return "No matching tools or skills found.";
	const firstLine = (text: string) => text.trim().split(/\r?\n/)[0];
	const lines = results.map((result) =>
		result.kind === "tool"
			? `- ${result.name}: ${firstLine(result.description)}`
			: `- ${SKILL_PREFIX}${result.name}: ${firstLine(result.description)} (${result.filePath})`,
	);
	const toolCount = results.filter((result) => result.kind === "tool").length;
	const headers: string[] = [];
	if (toolCount > 0) {
		headers.push(`Loaded ${toolCount} tool${toolCount === 1 ? "" : "s"}. They are available from your next call`);
	}
	if (toolCount < results.length) headers.push("To use a skill, read its file");
	return `${headers.join(". ")}:\n${lines.join("\n")}`;
}

/**
 * The `tool_search` description. It does not list the searchable tools or their namespaces, so it
 * stays the same while tools are registered, for example when MCP servers connect.
 */
export const TOOL_SEARCH_DESCRIPTION = `# Tool discovery\n\nSearches over deferred tool metadata with BM25 and exposes matching tools for the next model call.\n\nSome of the tools, such as tools of MCP servers, may not have been provided to you upfront, and you should use this tool (\`${TOOL_SEARCH_TOOL_NAME}\`) to search for the required tools. For MCP tool discovery, always use \`${TOOL_SEARCH_TOOL_NAME}\`.\n\nIt also finds skills. A skill is not loaded as a tool: read its file to use it.`;

export function createToolSearchToolDefinition(
	options: ToolSearchToolOptions = {},
): ToolDefinition<typeof toolSearchSchema, ToolSearchToolDetails> {
	return {
		name: TOOL_SEARCH_TOOL_NAME,
		label: TOOL_SEARCH_TOOL_NAME,
		description: TOOL_SEARCH_DESCRIPTION,
		promptSnippet: "Search for tools that are not loaded yet and load the matches; also finds skills",
		parameters: toolSearchSchema,
		// See docs/adr/coding-agent/extensions-tool-search-tool.md#model-only-exposure-for-tool-search
		exposure: "model-only",
		async execute(_toolCallId, { query, limit }) {
			if (query.trim() === "") throw new Error("query must not be empty");
			const max = limit ?? DEFAULT_TOOL_SEARCH_LIMIT;
			if (!Number.isInteger(max) || max <= 0) throw new Error("limit must be a positive integer");
			const results = searchAndLoad(options, query, max);
			return {
				content: [{ type: "text", text: formatToolSearchResults(results) }],
				details: {
					loaded: results.filter((result) => result.kind === "tool").map((result) => result.name),
					skills: results.filter((result) => result.kind === "skill").map((result) => result.name),
				},
			};
		},
	};
}
