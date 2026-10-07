import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import type { AgentMessage, AgentToolResult, ThinkingLevel } from "@akramcode/agent-core";
import type { AssistantMessage, Model } from "@akramcode/ai";
import type { SandboxRuntime } from "@akramcode/sandbox";
import { Container, Markdown, Text } from "@akramcode/tui";
import { type Static, Type } from "typebox";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import { getMarkdownTheme, type Theme } from "../../modes/interactive/theme/theme.ts";
import { createExtensionRuntime } from "../extensions/loader.ts";
import type { ToolDefinition } from "../extensions/types.ts";
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
	STANDARD_TOOL_NAMES,
	type SubagentToolCandidate,
} from "./agent-types.ts";

const DEFAULT_AGENT_TYPE = "general-purpose";
/** Recent tool calls kept for progress display. */
const MAX_ACTIVITY_ITEMS = 20;
/** Tool calls the collapsed progress view shows. */
const VISIBLE_ACTIVITY_ITEMS = 3;

/** Creates the child session of a subagent. `createAgentSession` in production; injected to avoid an import cycle. */
export type SubagentSessionFactory = (options: CreateAgentSessionOptions) => Promise<CreateAgentSessionResult>;

/** A parent tool a subagent can get, with the definition to give it. */
export interface SubagentToolSource extends SubagentToolCandidate {
	/** Built-in tools are recreated in the child; others are shared by definition. */
	builtin: boolean;
	definition: ToolDefinition;
}

/** Agent type management for `/agents`. */
export interface SubagentControl {
	listTypes(): AgentTypeDiscovery;
	/** The tools a type gets in this session, and its tool entries that match no tool. */
	resolveTools(type: AgentTypeDefinition): { tools: string[]; unknown: string[] };
	/** Tools of this session that agent types can list. */
	listTools(): Array<{ name: string; description: string; active: boolean }>;
	userAgentsDir: string;
	projectAgentsDir: string;
	isProjectTrusted(): boolean;
	/** Read the agent definitions again, for example after writing one. */
	reload(): void;
}

/** What the `agent` tool needs from the parent session. */
export interface SubagentHost {
	cwd: string;
	agentDir: string;
	settingsManager: SettingsManager;
	modelRuntime: ModelRuntime;
	/** The parent's sandbox; subagents run their tools in it too. */
	sandbox: SandboxRuntime | undefined;
	/** Registry for `run_in_background`. Without it the parameter is not offered. */
	tasks: TaskRegistry | undefined;
	getModel(): Model<any> | undefined;
	getThinkingLevel(): ThinkingLevel;
	getContextFiles(): Array<{ path: string; content: string }>;
	/** Agent types, read when the session starts and after `/agents` changes them. */
	getAgentTypes(): AgentTypeDiscovery;
	/** Tools of the parent a subagent can get. */
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
	description: Type.String({ description: "Short (3-5 word) description of the task" }),
	prompt: Type.String({
		description:
			"The task for the agent. Make it self-contained: the agent does not see this conversation. State the goal, relevant paths and facts, and what to report back.",
	}),
	subagent_type: Type.Optional(Type.String({ description: `Type of agent to use (default: ${DEFAULT_AGENT_TYPE})` })),
	model: Type.Optional(
		Type.String({
			description:
				"Optional model override as provider/model-id or a model pattern. Default: the agent type's model, else the current model.",
		}),
	),
};

const agentSchema = Type.Object(agentProperties);
const backgroundAgentSchema = Type.Object({
	...agentProperties,
	run_in_background: Type.Optional(
		Type.Boolean({
			description:
				"Run the agent in the background and return at once with a task id. You are notified with its result when it finishes.",
		}),
	),
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

/** Run one subagent to completion in a child session. Aborting `signal` aborts the child. */
async function runSubagent(
	host: SubagentHost,
	type: AgentTypeDefinition,
	prompt: string,
	modelPattern: string | undefined,
	signal: AbortSignal | undefined,
	onProgress: (progress: SubagentProgress, newActivity: string | undefined) => void,
): Promise<SubagentRunResult> {
	const model = resolveSubagentModel(host, modelPattern ?? type.model);
	const sources = host.getToolSources();
	const { tools } = resolveAgentTypeTools(type, sources);
	// Extension and MCP tools are shared by definition and declared directly, whatever their
	// exposure in the parent: the child has no codemode or tool search to reach them otherwise.
	const customTools = sources
		.filter((source) => !source.builtin && tools.includes(source.name))
		.map((source): ToolDefinition => ({ ...source.definition, exposure: "direct", defaultActive: undefined }));
	const transcriptDir = host.getTranscriptDir();
	mkdirSync(transcriptDir, { recursive: true });
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

function formatAgentTypeList(types: readonly AgentTypeDefinition[], sources: readonly SubagentToolCandidate[]): string {
	return types
		.map((type) => {
			const tools =
				type.tools || type.disallowedTools
					? resolveAgentTypeTools(type, sources).tools.join(", ") || "none"
					: "all";
			return `- ${type.name}: ${type.description} (Tools: ${tools})`;
		})
		.join("\n");
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
	const backgroundUsage = tasks
		? "\n- run_in_background: true returns at once with a task id; you are notified with the result when the agent finishes. Use it when you have independent work to do meanwhile."
		: "";
	const describe = (
		candidates: readonly SubagentToolCandidate[],
	) => `Launch a subagent that handles a task autonomously in a fresh context, with its own instructions and tools. Only its final message is returned to you.

Available agent types (subagent_type):
${formatAgentTypeList(host.getAgentTypes().types, candidates)}

Usage:
- The agent does not see this conversation: write a self-contained prompt with the goal, relevant context, and what to report back.
- Launch several agents in one message to run them concurrently.
- Use agents for broad searches and multi-step work whose intermediate output you do not need; do a simple lookup yourself.
- The result is not shown to the user; relay what matters.${backgroundUsage}`;
	return {
		name: "agent",
		label: "agent",
		description: describe(STANDARD_TOOL_NAMES.map((name) => ({ name, active: true }))),
		// The tool lists of agent types depend on the registered tools, which change after creation
		// (extensions, MCP servers that connect later).
		prepareLoadout: (loadout) => {
			const declared = new Set(loadout.declared.map((tool) => tool.name));
			const candidates = loadout.registered
				.filter((tool) => loadout.getExposure(tool.name) !== "hidden")
				.map((tool) => ({ name: tool.name, active: declared.has(tool.name) }));
			return { descriptions: { agent: describe(candidates) } };
		},
		promptSnippet: "Delegate a task to a subagent with a fresh context (subagent_type selects its tools)",
		// Without a task registry the model is not offered `run_in_background`.
		parameters: (tasks ? backgroundAgentSchema : agentSchema) as typeof backgroundAgentSchema,
		async execute(_toolCallId, params, signal, onUpdate) {
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
				runSubagent(host, type, params.prompt, params.model, task.signal, (progress, item) => {
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
							text: `Agent running in background with ID: ${task.id}. Progress is written to: ${task.outputFile}\nYou will be notified with its result when it finishes. Use task_stop to stop it.`,
						},
					],
					details: makeDetails(progress, "running", { taskId: task.id, outputFile: task.outputFile }),
				};
			}

			onUpdate?.({
				content: [{ type: "text", text: "(running...)" }],
				details: makeDetails({ toolUses: 0, usage: emptyTaskUsage(), activity: [] }, "running"),
			});
			const result = await runSubagent(host, type, params.prompt, params.model, signal, (progress) => {
				onUpdate?.({
					content: [{ type: "text", text: "(running...)" }],
					details: makeDetails(progress, "running"),
				});
			});
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
