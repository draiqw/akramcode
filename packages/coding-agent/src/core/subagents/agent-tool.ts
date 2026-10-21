import { homedir } from "node:os";
import type { AgentToolResult, ThinkingLevel } from "@akramcode/agent-core";
import type { Model } from "@akramcode/ai";
import type { SandboxRuntime } from "@akramcode/sandbox";
import { Container, Markdown, Text } from "@akramcode/tui";
import { type Static, Type } from "typebox";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import { getMarkdownTheme, type Theme } from "../../modes/interactive/theme/theme.ts";
import type { AgentSession } from "../agent-session.ts";
import { createExtensionRuntime } from "../extensions/loader.ts";
import type { ExtensionToolContext, ToolDefinition } from "../extensions/types.ts";
import { resolveCliModel } from "../model-resolver.ts";
import type { ModelRuntime } from "../model-runtime.ts";
import type { ResourceLoader } from "../resource-loader.ts";
import type { CreateAgentSessionOptions, CreateAgentSessionResult } from "../sdk.ts";
import { SessionManager } from "../session-manager.ts";
import type { SettingsManager } from "../settings-manager.ts";
import { formatElapsed, formatTokenCount } from "../tasks/notifications.ts";
import { str } from "../tools/render-utils.ts";
import {
	type AgentTypeDefinition,
	type AgentTypeDiscovery,
	resolveAgentTypeTools,
	type SubagentToolCandidate,
} from "./agent-types.ts";
import {
	type SubagentInfo,
	type SubagentRegistry,
	type SubagentUsage,
	subagentElapsedMs,
} from "./subagent-registry.ts";

const DEFAULT_AGENT_TYPE = "general-purpose";
/** Tool calls the collapsed progress view shows. */
const VISIBLE_ACTIVITY_ITEMS = 3;
/** Lines of the final text the collapsed result shows. */
const PREVIEW_LINES = 2;

/** Creates the child session of a subagent. `createAgentSession` in production; injected to avoid an import cycle. */
export type SubagentSessionFactory = (options: CreateAgentSessionOptions) => Promise<CreateAgentSessionResult>;

/** A parent tool a subagent can get, with its definition for the declaration. */
export interface SubagentToolSource extends SubagentToolCandidate {
	definition: ToolDefinition;
}

/** Parameters that start background work; subagents never get them. */
const BACKGROUND_PARAMETERS = ["run_in_background", "monitor"];

/** Agent type management for `/agents`. */
export interface SubagentControl {
	listTypes(): AgentTypeDiscovery;
	/** The tools a type gets in this session, and its tool entries that match no tool. */
	resolveTools(type: AgentTypeDefinition): { tools: string[]; unknown: string[] };
	/** Tools of this session that agent types can list. */
	listTools(): Array<{ name: string; description: string; active: boolean }>;
	userAgentsDir: string;
	projectAgentsDir: string;
	/** Read the agent definitions again, for example after writing one. */
	reload(): void;
}

/** What the `agent` tool needs from the parent session. */
export interface SubagentHost {
	cwd: string;
	agentDir: string;
	settingsManager: SettingsManager;
	modelRuntime: ModelRuntime;
	/** The parent's sandbox; the child session must not acquire its own. */
	sandbox: SandboxRuntime | undefined;
	/** Subagents of the parent session. */
	subagents: SubagentRegistry;
	/** Whether `run_in_background` is offered. */
	background: boolean;
	getModel(): Model<any> | undefined;
	getThinkingLevel(): ThinkingLevel;
	getContextFiles(): Array<{ path: string; content: string }>;
	/** Agent types, read when the session starts and after `/agents` changes them. */
	getAgentTypes(): AgentTypeDiscovery;
	/** Tools of the parent a subagent can get: only tools the parent can call itself. */
	getToolSources(): SubagentToolSource[];
	/** Directory for subagent transcripts. */
	getTranscriptDir(): string;
	createSession: SubagentSessionFactory;
}

export interface AgentToolDetails {
	agentId: string;
	agentType: string;
	description: string;
	status: "running" | "completed" | "failed" | "stopped";
	toolUses: number;
	usage: SubagentUsage;
	durationMs: number;
	/** Recent tool calls, oldest first. */
	activity: string[];
	model?: string;
	transcriptFile?: string;
	/** Set when the agent runs in the background. */
	background?: boolean;
}

const agentProperties = {
	description: Type.String({ description: "3-5 words" }),
	prompt: Type.String(),
	subagent_type: Type.Optional(Type.String()),
	model: Type.Optional(Type.String()),
};

const agentSchema = Type.Object(agentProperties);
const backgroundAgentSchema = Type.Object({
	...agentProperties,
	run_in_background: Type.Optional(Type.Boolean({ description: "Return at once; the result arrives when done" })),
});

export type AgentToolInput = Static<typeof backgroundAgentSchema>;

const agentMessageSchema = Type.Object({
	agent_id: Type.String(),
	message: Type.String(),
});

export type AgentMessageToolInput = Static<typeof agentMessageSchema>;

function shortenPath(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function truncate(text: string, max: number): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** One-line description of a subagent tool call, for example `read ~/src/index.ts`. */
export function describeToolCall(toolName: string, args: Record<string, unknown> | undefined): string {
	const value = (key: string) => (typeof args?.[key] === "string" ? (args[key] as string) : "");
	switch (toolName) {
		case "bash":
			return `$ ${truncate(value("command"), 70)}`;
		case "read":
		case "write":
		case "edit":
			return `${toolName} ${shortenPath(value("path") || value("file_path"))}`;
		case "ls":
			return `ls ${shortenPath(value("path") || ".")}`;
		case "grep":
			return `grep /${truncate(value("pattern"), 40)}/${value("path") ? ` in ${shortenPath(value("path"))}` : ""}`;
		case "find":
			return `find ${truncate(value("pattern"), 40)}${value("path") ? ` in ${shortenPath(value("path"))}` : ""}`;
		default:
			return `${toolName} ${truncate(JSON.stringify(args ?? {}), 50)}`;
	}
}

function buildSubagentPrompt(type: AgentTypeDefinition): string {
	const date = new Date().toISOString().slice(0, 10);
	return [
		"You are a subagent of akramcode, a coding agent harness. The main agent delegated a task to you. You work in a fresh context: the main agent sees only your final message, not your tool calls.",
		type.systemPrompt,
		"When you are done, reply with a concise report of what you did and found; the main agent relays it to the user. Include absolute file paths and exact values where they matter. You cannot ask questions and wait for answers, so make reasonable assumptions and state them. The main agent or the user may send you more messages later; handle them the same way.",
		`Current date: ${date}`,
	]
		.filter((part) => part.trim().length > 0)
		.join("\n\n");
}

/** A resource loader with the subagent prompt and the parent's context files, and no extensions or skills. */
function createSubagentResourceLoader(
	systemPrompt: string,
	contextFiles: Array<{ path: string; content: string }>,
): ResourceLoader {
	const runtime = createExtensionRuntime();
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: contextFiles }),
		getSystemPrompt: () => systemPrompt,
		getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => [],
		getAppendSystemPromptSources: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

function resolveSubagentModel(host: SubagentHost, pattern: string | undefined): Model<any> | undefined {
	if (!pattern || pattern === "inherit") return host.getModel();
	const resolved = resolveCliModel({ cliModel: pattern, modelRuntime: host.modelRuntime });
	if (resolved.error || !resolved.model) throw new Error(resolved.error ?? `Unknown model "${pattern}"`);
	return resolved.model;
}

type ExecuteParentTool = ExtensionToolContext["executeTool"];

/** `schema` without the properties `names`, when it is an object schema. */
function withoutProperties(
	schema: ToolDefinition["parameters"],
	names: readonly string[],
): ToolDefinition["parameters"] {
	const object = schema as { properties?: Record<string, unknown>; required?: string[] };
	if (!object.properties || !names.some((name) => name in (object.properties ?? {}))) return schema;
	const properties = Object.fromEntries(Object.entries(object.properties).filter(([name]) => !names.includes(name)));
	const required = object.required?.filter((name) => !names.includes(name));
	return { ...schema, properties, ...(required ? { required } : {}) } as ToolDefinition["parameters"];
}

/**
 * A subagent's stand-in for a parent tool. The call runs in the parent session through
 * `ctx.executeTool()`, so it passes the parent's argument validation, `tool_call` and `tool_result`
 * hooks, and permission checks, and uses the parent's tool implementation, cwd, and sandbox, as if
 * the parent had called the tool. Background parameters are removed.
 */
function createParentToolProxy(source: SubagentToolSource, executeParentTool: ExecuteParentTool): ToolDefinition {
	const { definition } = source;
	return {
		name: definition.name,
		label: definition.label,
		description: definition.description,
		parameters: withoutProperties(definition.parameters, BACKGROUND_PARAMETERS),
		...(definition.executionMode ? { executionMode: definition.executionMode } : {}),
		async execute(_callId, input, abortSignal, onPartial) {
			const args = Object.fromEntries(
				Object.entries((input ?? {}) as Record<string, unknown>).filter(
					([key]) => !BACKGROUND_PARAMETERS.includes(key),
				),
			);
			const outcome = await executeParentTool(definition.name, args, { signal: abortSignal, onUpdate: onPartial });
			if (outcome.isError) {
				const text = outcome.result.content
					.filter((part): part is { type: "text"; text: string } => part.type === "text")
					.map((part) => part.text)
					.join("\n");
				throw new Error(text || `${definition.name} failed`);
			}
			return outcome.result;
		},
	};
}

/** Create the child session of a subagent. Its tools are proxies for parent tools. */
async function createSubagentSession(
	host: SubagentHost,
	type: AgentTypeDefinition,
	model: Model<any> | undefined,
	executeParentTool: ExecuteParentTool,
): Promise<AgentSession> {
	const sources = host.getToolSources();
	const { tools } = resolveAgentTypeTools(type, sources);
	// Every child tool is a proxy for a parent tool the parent can call itself; the child's own
	// built-in tools of the same names are replaced.
	const customTools = sources
		.filter((source) => tools.includes(source.name))
		.map((source) => createParentToolProxy(source, executeParentTool));
	const { session } = await host.createSession({
		cwd: host.cwd,
		agentDir: host.agentDir,
		modelRuntime: host.modelRuntime,
		settingsManager: host.settingsManager,
		model,
		thinkingLevel: type.thinking ?? host.getThinkingLevel(),
		tools,
		customTools,
		resourceLoader: createSubagentResourceLoader(buildSubagentPrompt(type), host.getContextFiles()),
		sessionManager: SessionManager.create(host.cwd, host.getTranscriptDir()),
		subagent: { sandbox: host.sandbox },
	});
	return session;
}

/** Agent types other than the built-ins, one short line each. */
function formatCustomAgentTypes(types: readonly AgentTypeDefinition[]): string {
	return types
		.filter((type) => type.source !== "builtin")
		.map((type) => `\n- ${type.name}: ${truncate(type.description, 100)}`)
		.join("");
}

function toDetails(agent: SubagentInfo, background: boolean): AgentToolDetails {
	return {
		agentId: agent.id,
		agentType: agent.agentType,
		description: agent.description,
		status: agent.status,
		toolUses: agent.usage.toolUses,
		usage: agent.usage,
		durationMs: subagentElapsedMs(agent),
		activity: agent.activity,
		model: agent.model,
		transcriptFile: agent.transcriptFile,
		...(background ? { background: true } : {}),
	};
}

/** `5m 05s · 922k tokens`. */
export function formatSubagentStats(durationMs: number, totalTokens: number): string {
	return [formatElapsed(durationMs), ...(totalTokens > 0 ? [`${formatTokenCount(totalTokens)} tokens`] : [])].join(
		" · ",
	);
}

/** `Agent "Find the parser"` with the description highlighted. */
export function formatAgentTitle(description: string, theme: Theme): string {
	return `${theme.fg("toolTitle", theme.bold("Agent"))} ${theme.fg("accent", `"${truncate(description, 80)}"`)}`;
}

/** The first lines of a result, each cut to one line. */
export function previewLines(text: string, count = PREVIEW_LINES): string[] {
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const shown = lines.slice(0, count).map((line) => truncate(line, 160));
	if (lines.length > count) shown[shown.length - 1] = `${shown[shown.length - 1]} …`;
	return shown;
}

function renderAgentResult(
	result: AgentToolResult<AgentToolDetails | undefined>,
	expanded: boolean,
	isPartial: boolean,
	isError: boolean,
	theme: Theme,
): Container {
	const container = new Container();
	const details = result.details;
	const text = result.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	const branch = theme.fg("muted", "⎿ ");
	if (isError || !details) {
		container.addChild(new Text(`${branch}${theme.fg(isError ? "error" : "toolOutput", text)}`, 1, 0));
		return container;
	}
	if (details.background) {
		container.addChild(new Text(`${branch}${theme.fg("muted", `Started in background · ${details.agentId}`)}`, 1, 0));
		return container;
	}
	if (isPartial || details.status === "running") {
		const visible = details.activity.slice(-VISIBLE_ACTIVITY_ITEMS);
		const hidden = details.toolUses - visible.length;
		const lines: string[] = [];
		if (hidden > 0) lines.push(theme.fg("dim", `  +${hidden} more tool use${hidden === 1 ? "" : "s"}`));
		for (const item of visible) lines.push(`  ${theme.fg("toolOutput", item)}`);
		lines.unshift(
			`${branch}${theme.fg("muted", `Running · ${formatSubagentStats(details.durationMs, details.usage.totalTokens)}`)}`,
		);
		container.addChild(new Text(lines.join("\n"), 1, 0));
		return container;
	}
	const stats = formatSubagentStats(details.durationMs, details.usage.totalTokens);
	const done = `${branch}${theme.fg("success", "Finished")}${theme.fg("muted", ` · ${stats}`)}`;
	if (!expanded) {
		const report = text.replace(/\n\nagent_id: \S+.*$/s, "");
		const preview = previewLines(report).map((line) => `  ${theme.fg("toolOutput", line)}`);
		container.addChild(
			new Text(
				[`${done} ${theme.fg("dim", `(${keyHint("app.tools.expand", "to expand")})`)}`, ...preview].join("\n"),
				1,
				0,
			),
		);
		return container;
	}
	container.addChild(new Text(done, 1, 0));
	container.addChild(new Markdown(text, 3, 0, getMarkdownTheme()));
	if (details.transcriptFile) {
		container.addChild(new Text(theme.fg("dim", `  Transcript: ${shortenPath(details.transcriptFile)}`), 1, 0));
	}
	return container;
}

/** Text the main agent gets from a foreground run: the report and the id to continue the agent. */
function formatForegroundResult(id: string, text: string): string {
	return `${text}\n\nagent_id: ${id} (send it more work with agent_message)`;
}

/** The `agent` tool: delegate a task to a subagent that runs in a child session of this process. */
export function createAgentToolDefinition(
	host: SubagentHost,
): ToolDefinition<typeof backgroundAgentSchema, AgentToolDetails | undefined> {
	// Kept short: the description is sent with every request. Details are in docs/subagents.md.
	const describe = () =>
		`Run a subagent on a self-contained task in a fresh context (it cannot see this conversation); returns its final message and agent_id. Calls in one message run in parallel. subagent_type: general-purpose (default), explore (read-only search)${formatCustomAgentTypes(host.getAgentTypes().types)}`;
	return {
		name: "agent",
		label: "agent",
		description: describe(),
		// Refresh the type list when `/agents` changes the definitions.
		prepareLoadout: () => ({ descriptions: { agent: describe() } }),
		// Without background tasks the model is not offered `run_in_background`.
		parameters: (host.background ? backgroundAgentSchema : agentSchema) as typeof backgroundAgentSchema,
		renderShell: "self",
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			// Subagent tool calls run in this session through the calling tool's context.
			const executeParentTool: ExecuteParentTool = (name, args, options) => ctx.executeTool(name, args, options);
			const typeName = params.subagent_type?.trim() || DEFAULT_AGENT_TYPE;
			const currentTypes = host.getAgentTypes().types;
			const type = currentTypes.find((candidate) => candidate.name === typeName);
			if (!type) {
				throw new Error(
					`Unknown agent type "${typeName}". Available: ${currentTypes.map((candidate) => candidate.name).join(", ")}`,
				);
			}
			const background = params.run_in_background === true;
			if (background && !host.background) throw new Error("Background agents are not available in this session");
			const model = resolveSubagentModel(host, params.model ?? type.model);
			if (signal?.aborted) throw new Error("Agent aborted");
			const session = await createSubagentSession(host, type, model, executeParentTool);
			const registry = host.subagents;
			const agent = registry.add({
				agentType: type.name,
				description: params.description,
				session,
				describeToolCall,
			});

			if (background) {
				void registry.run(agent.id, params.prompt, { foreground: false, source: "agent" });
				return {
					content: [
						{
							type: "text",
							text: `Agent ${agent.id} is running in the background. You will be notified with its result when it finishes. Use agent_message to send it more instructions.`,
						},
					],
					details: toDetails(registry.get(agent.id) ?? agent, true),
				};
			}

			const update = (info: SubagentInfo) =>
				onUpdate?.({ content: [{ type: "text", text: "(running...)" }], details: toDetails(info, false) });
			const unsubscribe = registry.subscribe((event) => {
				if (event.agent.id === agent.id && event.type !== "finished") update(event.agent);
			});
			// The running time ticks between the agent's events too.
			const ticker = setInterval(() => {
				const info = registry.get(agent.id);
				if (info?.status === "running") update(info);
			}, 1000);
			ticker.unref?.();
			try {
				const result = await registry.run(agent.id, params.prompt, { foreground: true, source: "agent", signal });
				if (result.status !== "completed") throw new Error(result.error ?? `Agent ${result.status}`);
				const finished = registry.get(agent.id) ?? agent;
				return {
					content: [{ type: "text", text: formatForegroundResult(agent.id, result.text) }],
					details: toDetails(finished, false),
				};
			} finally {
				clearInterval(ticker);
				unsubscribe();
			}
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 1, 0);
			const description = str(args?.description) ?? "";
			const type = str(args?.subagent_type) || DEFAULT_AGENT_TYPE;
			const mark = context.isError
				? theme.fg("error", "●")
				: context.isPartial
					? theme.fg("accent", "●")
					: theme.fg("success", "●");
			text.setText(`${mark} ${formatAgentTitle(description, theme)} ${theme.fg("muted", `· ${type}`)}`);
			return text;
		},
		renderResult(result, options, theme, context) {
			return renderAgentResult(result, options.expanded, options.isPartial, context.isError, theme);
		},
	};
}

/** The `agent_message` tool: send a running agent more instructions, or continue a finished one. */
export function createAgentMessageToolDefinition(
	subagents: SubagentRegistry,
): ToolDefinition<typeof agentMessageSchema, { agentId: string; delivery: "steered" | "resumed" } | undefined> {
	return {
		name: "agent_message",
		label: "agent_message",
		description:
			"Send a message to an agent you started, by agent_id. A running agent reads it after its current step; a finished agent continues with its full context in the background, and you are notified with its reply.",
		parameters: agentMessageSchema,
		renderShell: "self",
		async execute(_toolCallId, { agent_id, message }) {
			const agent = subagents.get(agent_id);
			if (!agent) throw new Error(`No agent with id ${agent_id}`);
			const delivery = await subagents.send(agent_id, message, "agent");
			const text =
				delivery === "steered"
					? `Message delivered to running agent ${agent_id}.`
					: `Agent ${agent_id} resumed in the background. You will be notified with its reply.`;
			return { content: [{ type: "text", text }], details: { agentId: agent_id, delivery } };
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 1, 0);
			const agent = subagents.get(str(args?.agent_id) ?? "");
			const title = agent ? formatAgentTitle(agent.description, theme) : theme.fg("toolTitle", theme.bold("Agent"));
			const mark = context.isError ? theme.fg("error", "●") : theme.fg("accent", "●");
			const message = previewLines(str(args?.message) ?? "", 1)[0] ?? "";
			text.setText(
				`${mark} ${title} ${theme.fg("muted", "· message")}\n${theme.fg("muted", "⎿ ")}${theme.fg("toolOutput", message)}`,
			);
			return text;
		},
		renderResult(result, _options, theme, context) {
			if (!context.isError) return new Container();
			const text = result.content
				.filter((part): part is { type: "text"; text: string } => part.type === "text")
				.map((part) => part.text)
				.join("\n");
			return new Text(`${theme.fg("muted", "⎿ ")}${theme.fg("error", text)}`, 1, 0);
		},
	};
}
