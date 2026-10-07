import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel } from "@akramcode/agent-core";
import { CONFIG_DIR_NAME } from "../../config.ts";
import { parseFrontmatter } from "../../utils/frontmatter.ts";
import { THINKING_LEVEL_OPTIONS } from "../defaults.ts";

/** A subagent type: who the `agent` tool can delegate to. */
export interface AgentTypeDefinition {
	name: string;
	description: string;
	/**
	 * Tool allowlist: exact names or `*` wildcards such as `mcp__github__*`. Undefined means the
	 * parent's active tools plus the standard built-in tools.
	 */
	tools?: string[];
	/** Tool denylist, applied after `tools`, with the same syntax. */
	disallowedTools?: string[];
	/** Model pattern, as for `--model`. Undefined means the parent's model. */
	model?: string;
	/** Thinking level. Undefined means the parent's level. */
	thinking?: ThinkingLevel;
	/** Type-specific system prompt. */
	systemPrompt: string;
	source: "builtin" | "user" | "project";
	filePath?: string;
}

/** A problem with an agent definition file. */
export interface AgentTypeDiagnostic {
	path: string;
	message: string;
}

export interface AgentTypeDiscovery {
	types: AgentTypeDefinition[];
	diagnostics: AgentTypeDiagnostic[];
}

/** A tool of the parent session that a subagent could get. */
export interface SubagentToolCandidate {
	name: string;
	/** Whether the parent currently declares the tool to its model. */
	active: boolean;
}

/** Built-in tools every session has. */
export const STANDARD_TOOL_NAMES: readonly string[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];

/** Tools subagents never get: they cannot start agents or control background tasks. */
export const SUBAGENT_EXCLUDED_TOOL_NAMES: readonly string[] = ["agent", "task_stop", "monitor"];

export const BUILTIN_AGENT_TYPES: readonly AgentTypeDefinition[] = [
	{
		name: "general-purpose",
		description:
			"General-purpose agent for multi-step tasks: researching questions, searching code, and making changes. Use it when a task needs many steps or a search may take several tries.",
		systemPrompt:
			"Complete the task fully, without gold-plating. Search broadly when you do not know where something is. Prefer editing existing files to creating new ones.",
		source: "builtin",
	},
	{
		name: "explore",
		description:
			"Fast read-only agent for exploring codebases: finding files, searching code, and answering questions about how code works. Say how thorough to be (quick, medium, or very thorough).",
		tools: ["read", "grep", "find", "ls", "bash"],
		systemPrompt:
			"You are a read-only explorer. Do not create, modify, or delete files, and do not run commands that change state (no installs, writes, git commits, or redirects into files). Use bash only for read-only commands such as ls, git log, git diff, or rg. Search efficiently and report findings with file paths and line numbers.",
		source: "builtin",
	},
];

const AGENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** Whether `name` can name an agent type and its file. */
export function isValidAgentTypeName(name: string): boolean {
	return AGENT_NAME_PATTERN.test(name);
}

/**
 * Raw agent frontmatter. Values are `unknown` because `parseFrontmatter` runs a YAML parser.
 * A type alias picks up the implicit index signature `parseFrontmatter` requires.
 */
type AgentFrontmatter = {
	name?: unknown;
	description?: unknown;
	tools?: unknown;
	disallowedTools?: unknown;
	model?: unknown;
	thinking?: unknown;
};

/** Accept `tools: read, bash` and `tools: [read, bash]`; anything else means no tool list. */
function parseToolList(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tools = raw
		.filter((tool): tool is string => typeof tool === "string")
		.map((tool) => tool.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

function loadAgentTypesFromDir(dir: string, source: "user" | "project", discovery: AgentTypeDiscovery): void {
	let entries: string[];
	try {
		entries = readdirSync(dir).sort();
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!entry.endsWith(".md")) continue;
		const filePath = join(dir, entry);
		const warn = (message: string) => discovery.diagnostics.push({ path: filePath, message });
		try {
			const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(readFileSync(filePath, "utf-8"));
			const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
			if (!name || !isValidAgentTypeName(name)) {
				warn("Skipped: frontmatter needs a `name` of letters, digits, `-`, `_`, or `.`");
				continue;
			}
			if (typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
				warn("Skipped: frontmatter needs a `description`");
				continue;
			}
			let thinking: ThinkingLevel | undefined;
			if (typeof frontmatter.thinking === "string" && frontmatter.thinking.trim() !== "inherit") {
				const level = frontmatter.thinking.trim() as ThinkingLevel;
				if (THINKING_LEVEL_OPTIONS.includes(level)) thinking = level;
				else warn(`Unknown thinking level "${frontmatter.thinking}"; using the parent's level`);
			}
			const model = typeof frontmatter.model === "string" ? frontmatter.model.trim() : "";
			discovery.types.push({
				name,
				description: frontmatter.description.trim(),
				tools: parseToolList(frontmatter.tools),
				disallowedTools: parseToolList(frontmatter.disallowedTools),
				model: model && model !== "inherit" ? model : undefined,
				thinking,
				systemPrompt: body.trim(),
				source,
				filePath,
			});
		} catch (error) {
			warn(`Skipped: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

export function getUserAgentsDir(agentDir: string): string {
	return join(agentDir, "agents");
}

export function getProjectAgentsDir(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "agents");
}

/**
 * Built-in types, then `<agentDir>/agents/*.md`, then `<cwd>/.akramcode/agents/*.md` when the project
 * is trusted. A later definition with the same name replaces an earlier one.
 */
export function discoverAgentTypes(options: {
	cwd: string;
	agentDir: string;
	projectTrusted: boolean;
}): AgentTypeDiscovery {
	const discovery: AgentTypeDiscovery = { types: [...BUILTIN_AGENT_TYPES], diagnostics: [] };
	loadAgentTypesFromDir(getUserAgentsDir(options.agentDir), "user", discovery);
	if (options.projectTrusted) loadAgentTypesFromDir(getProjectAgentsDir(options.cwd), "project", discovery);
	const byName = new Map<string, AgentTypeDefinition>();
	for (const type of discovery.types) byName.set(type.name, type);
	return { types: [...byName.values()], diagnostics: discovery.diagnostics };
}

function matchesToolPattern(pattern: string, name: string): boolean {
	if (!pattern.includes("*")) return pattern === name;
	const source = pattern
		.split("*")
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
		.join(".*");
	return new RegExp(`^${source}$`).test(name);
}

/**
 * The tools a subagent of `type` gets from the parent's `candidates`, and the `tools` and
 * `disallowedTools` entries that match no candidate. Without `tools`, the subagent gets the
 * parent's active tools and the standard built-ins. Agent and background-control tools are
 * always left out.
 */
export function resolveAgentTypeTools(
	type: Pick<AgentTypeDefinition, "tools" | "disallowedTools">,
	candidates: readonly SubagentToolCandidate[],
): { tools: string[]; unknown: string[] } {
	const available = candidates.filter((candidate) => !SUBAGENT_EXCLUDED_TOOL_NAMES.includes(candidate.name));
	const unknown: string[] = [];
	let selected: string[];
	if (type.tools) {
		selected = [];
		for (const pattern of type.tools) {
			if (SUBAGENT_EXCLUDED_TOOL_NAMES.includes(pattern)) continue;
			const matches = available.filter((candidate) => matchesToolPattern(pattern, candidate.name));
			if (matches.length === 0) unknown.push(pattern);
			for (const match of matches) if (!selected.includes(match.name)) selected.push(match.name);
		}
	} else {
		selected = available
			.filter((candidate) => candidate.active || STANDARD_TOOL_NAMES.includes(candidate.name))
			.map((candidate) => candidate.name);
	}
	for (const pattern of type.disallowedTools ?? []) {
		if (!available.some((candidate) => matchesToolPattern(pattern, candidate.name))) unknown.push(pattern);
		selected = selected.filter((name) => !matchesToolPattern(pattern, name));
	}
	return { tools: selected, unknown };
}

/** The Markdown file content of an agent definition. */
export function serializeAgentType(type: Omit<AgentTypeDefinition, "source" | "filePath">): string {
	// JSON strings are valid YAML scalars, so any description round-trips.
	const lines = ["---", `name: ${type.name}`, `description: ${JSON.stringify(type.description)}`];
	if (type.tools) lines.push(`tools: ${type.tools.join(", ")}`);
	if (type.disallowedTools) lines.push(`disallowedTools: ${type.disallowedTools.join(", ")}`);
	if (type.model) lines.push(`model: ${type.model}`);
	if (type.thinking) lines.push(`thinking: ${type.thinking}`);
	lines.push("---", "", type.systemPrompt.trim(), "");
	return lines.join("\n");
}
