/**
 * What `/stack` lists: skills, agents, extensions, MCP servers, commands, tools, and context files,
 * each with the level it comes from, whether it is in use, and its estimated system prompt tokens.
 */

import { homedir } from "node:os";
import { basename, dirname, sep } from "node:path";
import type { McpServerEntry } from "../extensions/mcp/config.ts";
import type { ResourceDiagnostic } from "./diagnostics.ts";
import type { Extension, ResolvedCommand, ToolInfo } from "./extensions/types.ts";
import { mcpNamespace } from "./mcp-servers.ts";
import type { PathMetadata, ResolvedPaths, ResolvedResource } from "./package-manager.ts";
import type { PromptTemplate } from "./prompt-templates.ts";
import type { Skill } from "./skills.ts";
import { BUILTIN_PATH_PREFIX, isSyntheticPath, type SourceScope } from "./source-info.ts";
import { type AgentTypeDiscovery, BUILTIN_AGENT_TYPES } from "./subagents/agent-types.ts";

/**
 * - `active`: in use; tokens count toward the system prompt.
 * - `manual`: a skill only `/skill:name` runs, so the model does not see it.
 * - `inactive`, `deferred`, `codemode`, `hidden`: a tool that is not declared to the model.
 * - `overridden`: an item of the same name from another level wins.
 * - `disabled`: turned off in settings or config.
 */
export type StackStatus =
	| "active"
	| "manual"
	| "inactive"
	| "deferred"
	| "codemode"
	| "hidden"
	| "overridden"
	| "disabled";

export interface StackItem {
	name: string;
	/** `builtin`, `user`, `project`, `extension`, `cli`, or another source such as `sdk`. */
	scope: string;
	status: StackStatus;
	/** Estimated tokens the item adds to every request; undefined when it adds none. */
	tokens?: number;
	/** Lines shown when the item is expanded: description, path, source. */
	details: string[];
}

export interface StackTab {
	label: string;
	/** Plural noun for the tab summary, e.g. "skills". */
	noun: string;
	items: StackItem[];
}

export interface StackSources {
	agentDir: string;
	skills: { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
	prompts: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
	extensions: Extension[];
	/** All configured resources, enabled or not, for disabled items and the level of overridden ones. */
	resolvedPaths: ResolvedPaths;
	/** Undefined when the `agent` tool is not available. */
	agentTypes?: AgentTypeDiscovery;
	mcpServers: McpServerEntry[];
	builtinCommands: ReadonlyArray<{ name: string; description: string }>;
	extensionCommands: ResolvedCommand[];
	tools: ToolInfo[];
	activeToolNames: string[];
	contextFiles: Array<{ path: string; content: string }>;
	/** SYSTEM.md replacing the default prompt. */
	customSystemPrompt?: { path: string; content: string };
	/** APPEND_SYSTEM.md contents and the files they came from. */
	appendSystemPrompt: { paths: string[]; contents: string[] };
}

/** Rough token count, as elsewhere in akramcode: characters / 4. */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function displayPath(path: string): string {
	const home = homedir();
	return path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
}

function scopeLabel(info: { source: string; scope: SourceScope }): string {
	if (info.source === "builtin") return "builtin";
	if (info.scope !== "temporary") return info.scope;
	return info.source === "local" || info.source === "cli" ? "cli" : info.source;
}

function sourceDetail(info: { source: string; path?: string }): string[] {
	if (info.path && isSyntheticPath(info.path)) return [];
	const lines = info.path ? [displayPath(info.path)] : [];
	if (info.source !== "local" && info.source !== "cli" && info.source !== "auto") lines.push(`from ${info.source}`);
	return lines;
}

/** Name of a skill or prompt file: the directory of a SKILL.md, else the file name without `.md`. */
function resourceName(path: string): string {
	const file = basename(path);
	return file === "SKILL.md" ? basename(dirname(path)) : file.replace(/\.md$/, "");
}

function extensionName(path: string): string {
	if (path.startsWith(BUILTIN_PATH_PREFIX)) return path.slice(BUILTIN_PATH_PREFIX.length);
	if (isSyntheticPath(path)) return path.slice(1, -1).split(":").slice(1).join(":") || path;
	const file = basename(path).replace(/\.[cm]?[jt]s$/, "");
	return file === "index" ? basename(dirname(path)) : file;
}

function findMetadata(path: string, resources: ResolvedResource[]): PathMetadata {
	const match = resources.find((resource) => path === resource.path || path.startsWith(`${resource.path}${sep}`));
	return match?.metadata ?? { source: "local", scope: "temporary", origin: "top-level" };
}

function disabledItems(resources: ResolvedResource[], name: (path: string) => string): StackItem[] {
	return resources
		.filter((resource) => !resource.enabled)
		.map((resource) => ({
			name: name(resource.path),
			scope: scopeLabel(resource.metadata),
			status: "disabled",
			details: sourceDetail({ ...resource.metadata, path: resource.path }),
		}));
}

function overriddenItems(diagnostics: ResourceDiagnostic[], resources: ResolvedResource[]): StackItem[] {
	return diagnostics.flatMap((diagnostic) => {
		const collision = diagnostic.collision;
		if (!collision) return [];
		const metadata = findMetadata(collision.loserPath, resources);
		return [
			{
				name: collision.name,
				scope: scopeLabel(metadata),
				status: "overridden",
				details: [displayPath(collision.loserPath), `overridden by ${displayPath(collision.winnerPath)}`],
			},
		];
	});
}

const STATUS_ORDER: readonly StackStatus[] = [
	"active",
	"manual",
	"inactive",
	"deferred",
	"codemode",
	"hidden",
	"overridden",
	"disabled",
];

function sortItems(items: StackItem[]): StackItem[] {
	return items.sort(
		(a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name),
	);
}

function toolTokens(tool: ToolInfo): number {
	return estimateTokens(
		tool.name + tool.description + JSON.stringify(tool.parameters) + (tool.promptGuidelines ?? []).join("\n"),
	);
}

function skillsTab(sources: StackSources): StackTab {
	const items: StackItem[] = sources.skills.skills.map((skill) => ({
		name: skill.name,
		scope: scopeLabel(skill.sourceInfo),
		status: skill.disableModelInvocation ? "manual" : "active",
		// The <skill> entry in the system prompt: name, description, location, and the XML around them.
		tokens: skill.disableModelInvocation
			? undefined
			: estimateTokens(`${skill.name}${skill.description}${skill.filePath}`) + 15,
		details: [skill.description, ...sourceDetail(skill.sourceInfo)],
	}));
	items.push(...overriddenItems(sources.skills.diagnostics, sources.resolvedPaths.skills));
	items.push(...disabledItems(sources.resolvedPaths.skills, resourceName));
	return { label: "skills", noun: "skills", items: sortItems(items) };
}

function agentsTab(sources: StackSources): StackTab {
	const discovery = sources.agentTypes;
	if (!discovery) return { label: "agents", noun: "agents", items: [] };
	const items: StackItem[] = discovery.types.map((type) => ({
		name: type.name,
		scope: type.source,
		status: "active",
		// The agent tool lists each type with its description cut to 100 characters.
		tokens: estimateTokens(`- ${type.name}: ${type.description.slice(0, 100)}`),
		details: [type.description, ...(type.filePath ? [displayPath(type.filePath)] : [])],
	}));
	for (const builtin of BUILTIN_AGENT_TYPES) {
		const winner = discovery.types.find((type) => type.name === builtin.name);
		if (winner && winner.source !== "builtin") {
			items.push({
				name: builtin.name,
				scope: "builtin",
				status: "overridden",
				details: [`overridden by ${winner.source}${winner.filePath ? ` ${displayPath(winner.filePath)}` : ""}`],
			});
		}
	}
	for (const diagnostic of discovery.diagnostics) {
		if (!diagnostic.message.includes("cannot replace")) continue;
		items.push({
			name: resourceName(diagnostic.path),
			scope: "project",
			status: "overridden",
			details: [displayPath(diagnostic.path), diagnostic.message],
		});
	}
	return { label: "agents", noun: "agents", items: sortItems(items) };
}

function extensionsTab(sources: StackSources, activeTools: ReadonlySet<string>): StackTab {
	const toolsByName = new Map(sources.tools.map((tool) => [tool.name, tool]));
	const items: StackItem[] = sources.extensions.map((extension) => {
		const tools = [...extension.tools.keys()];
		const tokens = tools
			.map((name) => toolsByName.get(name))
			.filter((tool): tool is ToolInfo => tool !== undefined && activeTools.has(tool.name))
			.reduce((sum, tool) => sum + toolTokens(tool), 0);
		const counts = [
			tools.length > 0 ? `${tools.length} tools` : "",
			extension.commands.size > 0 ? `${extension.commands.size} commands` : "",
		].filter(Boolean);
		return {
			name: extensionName(extension.path),
			scope: scopeLabel(extension.sourceInfo),
			status: "active",
			tokens: tokens > 0 ? tokens : undefined,
			details: [...(counts.length > 0 ? [counts.join(", ")] : []), ...sourceDetail(extension.sourceInfo)],
		};
	});
	items.push(...disabledItems(sources.resolvedPaths.extensions, extensionName));
	return { label: "ext", noun: "extensions", items: sortItems(items) };
}

function mcpTab(sources: StackSources, activeTools: ReadonlySet<string>): StackTab {
	const items: StackItem[] = sources.mcpServers.map((server) => {
		const prefix = `${mcpNamespace(server.name)}__`;
		const tokens = sources.tools
			.filter((tool) => tool.name.startsWith(prefix) && activeTools.has(tool.name))
			.reduce((sum, tool) => sum + toolTokens(tool), 0);
		const target =
			"url" in server.config ? server.config.url : [server.config.command, ...(server.config.args ?? [])].join(" ");
		return {
			name: server.name,
			scope: server.scope === "global" ? "user" : (server.scope ?? "user"),
			status: server.config.enabled === false ? "disabled" : "active",
			tokens: tokens > 0 ? tokens : undefined,
			details: [
				...(server.config.description ? [server.config.description] : []),
				target,
				`exposure: ${server.config.exposure ?? "codemode"}`,
				displayPath(server.source),
			],
		};
	});
	return { label: "mcp", noun: "MCP servers", items: sortItems(items) };
}

function commandsTab(sources: StackSources): StackTab {
	const items: StackItem[] = [
		...sources.builtinCommands.map((command) => ({
			name: `/${command.name}`,
			scope: "builtin",
			status: "active" as const,
			details: [command.description],
		})),
		...sources.extensionCommands.map((command) => ({
			name: `/${command.invocationName}`,
			scope: scopeLabel(command.sourceInfo),
			status: "active" as const,
			details: [...(command.description ? [command.description] : []), ...sourceDetail(command.sourceInfo)],
		})),
		...sources.prompts.prompts.map((prompt) => ({
			name: `/${prompt.name}`,
			scope: scopeLabel(prompt.sourceInfo),
			status: "active" as const,
			details: [...(prompt.description ? [prompt.description] : []), ...sourceDetail(prompt.sourceInfo)],
		})),
		...overriddenItems(sources.prompts.diagnostics, sources.resolvedPaths.prompts).map((item) => ({
			...item,
			name: `/${item.name}`,
		})),
		...disabledItems(sources.resolvedPaths.prompts, (path) => `/${resourceName(path)}`),
	];
	return { label: "cmds", noun: "commands", items: sortItems(items) };
}

function toolsTab(sources: StackSources, activeTools: ReadonlySet<string>): StackTab {
	const items: StackItem[] = sources.tools.map((tool) => {
		const active = activeTools.has(tool.name);
		const exposure = tool.exposure;
		return {
			name: tool.name,
			scope: scopeLabel(tool.sourceInfo),
			status: active ? "active" : exposure === "direct" || exposure === "model-only" ? "inactive" : exposure,
			tokens: active ? toolTokens(tool) : undefined,
			details: [tool.description.split("\n")[0], ...sourceDetail(tool.sourceInfo)],
		};
	});
	return { label: "tools", noun: "tools", items: sortItems(items) };
}

function contextTab(sources: StackSources): StackTab {
	const items: StackItem[] = sources.contextFiles.map((file) => ({
		name: basename(file.path),
		scope: file.path.startsWith(`${sources.agentDir}${sep}`) ? "user" : "project",
		status: "active",
		tokens: estimateTokens(file.content),
		details: [displayPath(file.path)],
	}));
	const custom = sources.customSystemPrompt;
	if (custom) {
		items.push({
			name: basename(custom.path),
			scope: custom.path.startsWith(`${sources.agentDir}${sep}`) ? "user" : "project",
			status: "active",
			tokens: estimateTokens(custom.content),
			details: [displayPath(custom.path), "replaces the default system prompt"],
		});
	}
	const append = sources.appendSystemPrompt;
	if (append.contents.length > 0) {
		const path = append.paths[0];
		items.push({
			name: path ? basename(path) : "append",
			scope: path === undefined ? "cli" : path.startsWith(`${sources.agentDir}${sep}`) ? "user" : "project",
			status: "active",
			tokens: estimateTokens(append.contents.join("\n")),
			details: append.paths.map(displayPath),
		});
	}
	return { label: "ctx", noun: "context files", items };
}

export function collectStack(sources: StackSources): StackTab[] {
	const activeTools = new Set(sources.activeToolNames);
	return [
		skillsTab(sources),
		agentsTab(sources),
		extensionsTab(sources, activeTools),
		mcpTab(sources, activeTools),
		commandsTab(sources),
		toolsTab(sources, activeTools),
		contextTab(sources),
	];
}
