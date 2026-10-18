import { homedir } from "node:os";
import type { AgentMessage, AgentToolResult, ThinkingLevel } from "@akramcode/agent-core";
import type { AssistantMessage, Model } from "@akramcode/ai";
import type { SandboxRuntime } from "@akramcode/sandbox";
import { Container, Markdown, Text } from "@akramcode/tui";
import { type Static, Type } from "typebox";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import { getMarkdownTheme, type Theme } from "../../modes/interactive/theme/theme.ts";
import { createExtensionRuntime } from "../extensions/loader.ts";
import type { ExtensionToolContext, ToolDefinition } from "../extensions/types.ts";
import { resolveCliModel } from "../model-resolver.ts";
import type { ModelRuntime } from "../model-runtime.ts";
import type { ResourceLoader } from "../resource-loader.ts";
import type { CreateAgentSessionOptions, CreateAgentSessionResult } from "../sdk.ts";
import { SessionManager } from "../session-manager.ts";
import type { SettingsManager } from "../settings-manager.ts";
import { formatElapsed, formatTokenCount } from "../tasks/notifications.ts";
import { emptyTaskUsage, type TaskRegistry, type TaskUsage } from "../tasks/task-registry.ts";
import { str } from "../tools/render-utils.ts";
import {
	type AgentTypeDefinition,
	type AgentTypeDiscovery,
	resolveAgentTypeTools,
	type SubagentToolCandidate,
} from "./agent-types.ts";

const DEFAULT_AGENT_TYPE = "general-purpose";
/** Recent tool calls kept for progress display. */
const MAX_ACTIVITY_ITEMS = 20;
/** Tool calls the collapsed progress view shows. */
const VISIBLE_ACTIVITY_ITEMS = 3;

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
	/** Registry for `run_in_background`. Without it the parameter is not offered. */
	tasks: TaskRegistry | undefined;
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
	agentType: string;
	description: string;
	status: "running" | "completed" | "failed";
	toolUses: number;
	usage: TaskUsage;
	durationMs: number;
	/** Recent tool calls, oldest first. */
	activity: string[];
	model?: string;
	transcriptFile?: string;
	/** Set when the agent runs in the background. */
	background?: { taskId: string; outputFile: string };
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

function getFinalText(messages: readonly AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") continue;
		const text = message.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.trim();
		if (text) return text;
	}
	return "";
}

function buildSubagentPrompt(type: AgentTypeDefinition): string {
	const date = new Date().toISOString().slice(0, 10);
	return [
		"You are a subagent of akramcode, a coding agent harness. The main agent delegated a task to you. You work in a fresh context: the main agent sees only your final message, not your tool calls.",
		type.systemPrompt,
		"When you are done, reply with a concise report of what you did and found; the main agent relays it to the user. Include absolute file paths and exact values where they matter. You cannot ask the user questions, so make reasonable assumptions and state them.",
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

interface SubagentProgress {
	toolUses: number;
	usage: TaskUsage;
	activity: string[];
	transcriptFile?: string;
	model?: string;
}

interface SubagentRunResult extends SubagentProgress {
	text: string;
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

/** Run one subagent to completion in a child session. Aborting `signal` aborts the child. */
async function runSubagent(
	host: SubagentHost,
	type: AgentTypeDefinition,
	prompt: string,
	modelPattern: string | undefined,
	signal: AbortSignal | undefined,
	executeParentTool: ExecuteParentTool,
	onProgress: (progress: SubagentProgress, newActivity: string | undefined) => void,
): Promise<SubagentRunResult> {
	const model = resolveSubagentModel(host, modelPattern ?? type.model);
	const sources = host.getToolSources();
	const { tools } = resolveAgentTypeTools(type, sources);
	// Every child tool is a proxy for a parent tool the parent can call itself; the child's own
	// built-in tools of the same names are replaced.
	const customTools = sources
		.filter((source) => tools.includes(source.name))
		.map((source) => createParentToolProxy(source, executeParentTool));
	const transcriptDir = host.getTranscriptDir();
	const { session: child } = await host.createSession({
		cwd: host.cwd,
		agentDir: host.agentDir,
		modelRuntime: host.modelRuntime,
		settingsManager: host.settingsManager,
		model,
		thinkingLevel: type.thinking ?? host.getThinkingLevel(),
		tools,
		customTools,
		resourceLoader: createSubagentResourceLoader(buildSubagentPrompt(type), host.getContextFiles()),
		sessionManager: SessionManager.create(host.cwd, transcriptDir),
		subagent: { sandbox: host.sandbox },
	});
	const progress: SubagentProgress = {
		toolUses: 0,
		usage: emptyTaskUsage(),
		activity: [],
		transcriptFile: child.sessionFile,
		model: child.model ? `${child.model.provider}/${child.model.id}` : undefined,
	};
	const unsubscribe = child.subscribe((event) => {
		if (event.type === "tool_execution_start") {
			progress.toolUses++;
			progress.usage.toolUses = progress.toolUses;
			const item = describeToolCall(event.toolName, event.args as Record<string, unknown> | undefined);
			progress.activity = [...progress.activity, item].slice(-MAX_ACTIVITY_ITEMS);
			onProgress(progress, item);
		} else if (event.type === "message_end" && event.message.role === "assistant") {
			const usage = (event.message as AssistantMessage).usage;
			progress.usage.turns++;
			progress.usage.input += usage.input;
			progress.usage.output += usage.output;
			progress.usage.cacheRead += usage.cacheRead;
			progress.usage.cacheWrite += usage.cacheWrite;
			progress.usage.totalTokens += usage.totalTokens;
			progress.usage.cost += usage.cost.total;
			onProgress(progress, undefined);
		}
	});
	const onAbort = () => {
		void child.abort();
	};
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		if (signal?.aborted) throw new Error("Agent aborted");
		await child.prompt(prompt, { expandPromptTemplates: false });
		if (signal?.aborted) throw new Error("Agent aborted");
		const last = child.messages.findLast((message): message is AssistantMessage => message.role === "assistant");
		if (last?.stopReason === "error") throw new Error(last.errorMessage || "Agent request failed");
		if (last?.stopReason === "aborted") throw new Error("Agent aborted");
		return { ...progress, transcriptFile: child.sessionFile, text: getFinalText(child.messages) || "(no output)" };
	} finally {
		signal?.removeEventListener("abort", onAbort);
		unsubscribe();
		child.dispose();
	}
}

/** Agent types other than the built-ins, one short line each. */
function formatCustomAgentTypes(types: readonly AgentTypeDefinition[]): string {
	return types
		.filter((type) => type.source !== "builtin")
		.map((type) => `\n- ${type.name}: ${truncate(type.description, 100)}`)
		.join("");
}

function statsLine(details: AgentToolDetails): string {
	return [
		`${details.toolUses} tool use${details.toolUses === 1 ? "" : "s"}`,
		`${formatTokenCount(details.usage.totalTokens)} tokens`,
		formatElapsed(details.durationMs),
	].join(" · ");
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
	if (isError || !details) {
		container.addChild(new Text(theme.fg(isError ? "error" : "toolOutput", text), 0, 0));
		return container;
	}
	if (details.background) {
		container.addChild(
			new Text(
				theme.fg(
					"muted",
					`Running in background (task ${details.background.taskId}) · ${details.background.outputFile}`,
				),
				0,
				0,
			),
		);
		return container;
	}
	if (isPartial || details.status === "running") {
		const visible = details.activity.slice(-VISIBLE_ACTIVITY_ITEMS);
		const hidden = details.toolUses - visible.length;
		const lines: string[] = [];
		if (hidden > 0) lines.push(theme.fg("dim", `+${hidden} more tool use${hidden === 1 ? "" : "s"}`));
		for (const item of visible) lines.push(`${theme.fg("muted", "⎿ ")}${theme.fg("toolOutput", item)}`);
		lines.push(theme.fg("muted", `Running… (${statsLine(details)})`));
		container.addChild(new Text(lines.join("\n"), 0, 0));
		return container;
	}
	const done = theme.fg("success", "Done") + theme.fg("muted", ` (${statsLine(details)})`);
	if (!expanded) {
		container.addChild(new Text(`${done} ${theme.fg("dim", `(${keyHint("app.tools.expand", "to expand")})`)}`, 0, 0));
		return container;
	}
	container.addChild(new Text(done, 0, 0));
	container.addChild(new Markdown(text, 0, 1, getMarkdownTheme()));
	if (details.transcriptFile) {
		container.addChild(new Text(theme.fg("dim", `Transcript: ${shortenPath(details.transcriptFile)}`), 0, 0));
	}
	return container;
}

/** The `agent` tool: delegate a task to a subagent that runs in a child session of this process. */
export function createAgentToolDefinition(
	host: SubagentHost,
): ToolDefinition<typeof backgroundAgentSchema, AgentToolDetails | undefined> {
	const tasks = host.tasks;
	// Kept short: the description is sent with every request. Details are in docs/subagents.md.
	const describe = () =>
		`Run a subagent on a self-contained task in a fresh context (it cannot see this conversation); returns its final message. Calls in one message run in parallel. subagent_type: general-purpose (default), explore (read-only search)${formatCustomAgentTypes(host.getAgentTypes().types)}`;
	return {
		name: "agent",
		label: "agent",
		description: describe(),
		// Refresh the type list when `/agents` changes the definitions.
		prepareLoadout: () => ({ descriptions: { agent: describe() } }),
		// Without a task registry the model is not offered `run_in_background`.
		parameters: (tasks ? backgroundAgentSchema : agentSchema) as typeof backgroundAgentSchema,
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
			const startedAt = Date.now();
			const makeDetails = (
				progress: SubagentProgress,
				status: AgentToolDetails["status"],
				background?: AgentToolDetails["background"],
			): AgentToolDetails => ({
				agentType: type.name,
				description: params.description,
				status,
				toolUses: progress.toolUses,
				usage: { ...progress.usage },
				durationMs: Date.now() - startedAt,
				activity: [...progress.activity],
				model: progress.model,
				transcriptFile: progress.transcriptFile,
				...(background ? { background } : {}),
			});

			if (params.run_in_background) {
				if (!tasks) throw new Error("Background agents are not available in this session");
				// Fail fast on a bad model instead of in the background.
				resolveSubagentModel(host, params.model ?? type.model);
				const task = tasks.create({ kind: "agent", description: params.description, agentType: type.name });
				task.write(`Agent ${type.name}: ${params.description}\n\nPrompt:\n${params.prompt}\n\nActivity:\n`);
				runSubagent(host, type, params.prompt, params.model, task.signal, executeParentTool, (progress, item) => {
					if (item) task.write(`- ${item}\n`);
					task.update({
						usage: { ...progress.usage },
						activity: [...progress.activity],
						transcriptFile: progress.transcriptFile,
					});
				}).then(
					(result) => {
						task.write(`\nResult:\n${result.text}\n`);
						task.update({ transcriptFile: result.transcriptFile });
						return task.finish({ status: "completed", result: result.text });
					},
					(error: unknown) => {
						const message = error instanceof Error ? error.message : String(error);
						task.write(`\nFailed: ${message}\n`);
						return task.finish({ status: "failed", error: message });
					},
				);
				const progress: SubagentProgress = { toolUses: 0, usage: emptyTaskUsage(), activity: [] };
				return {
					content: [
						{
							type: "text",
							text: `Agent running in background with ID: ${task.id}. Progress file: ${task.outputFile}\nYou will be notified with its result when it finishes.`,
						},
					],
					details: makeDetails(progress, "running", { taskId: task.id, outputFile: task.outputFile }),
				};
			}

			onUpdate?.({
				content: [{ type: "text", text: "(running...)" }],
				details: makeDetails({ toolUses: 0, usage: emptyTaskUsage(), activity: [] }, "running"),
			});
			const result = await runSubagent(
				host,
				type,
				params.prompt,
				params.model,
				signal,
				executeParentTool,
				(progress) => {
					onUpdate?.({
						content: [{ type: "text", text: "(running...)" }],
						details: makeDetails(progress, "running"),
					});
				},
			);
			return {
				content: [{ type: "text", text: result.text }],
				details: makeDetails(result, "completed"),
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const description = str(args?.description) ?? "";
			const type = str(args?.subagent_type) || DEFAULT_AGENT_TYPE;
			const suffix = [type, args?.run_in_background === true ? "background" : undefined].filter(Boolean).join(" · ");
			text.setText(
				`${theme.fg("toolTitle", theme.bold("agent"))}${theme.fg("accent", `(${description})`)} ${theme.fg("muted", suffix)}`,
			);
			return text;
		},
		renderResult(result, options, theme, context) {
			return renderAgentResult(result, options.expanded, options.isPartial, context.isError, theme);
		},
	};
}
