/**
 * Workflows: parameterized codemode scripts saved as `<name>.workflow.js` and run on demand.
 *
 * - `/workflow` picks a workflow and runs, dry-runs, or checks it; `/workflow run <name> [k=v ...]
 *   [--dry]` runs one; `/workflow check <name>` checks it without running. Each run is recorded in
 *   the session as a `workflow-run` custom message, so the agent sees the outcome.
 * - The `workflow_run` tool lets the agent run a workflow. It is registered when the session starts
 *   and at least one workflow exists, and its description lists them. In the TUI and RPC, running a
 *   workflow that may call tools without `readOnlyHint` asks the user first, unless it is a dry run.
 *
 * See docs/workflows.md.
 */

import { randomBytes } from "node:crypto";
import type { NestedToolCallRecord } from "@akramcode/ai";
import { Text } from "@akramcode/tui";
import { Type } from "typebox";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionFactory,
	ExtensionToolContext,
	ToolAnnotations,
} from "../../core/extensions/types.ts";
import { checkWorkflow, formatCheckResult } from "./check.ts";
import { discoverWorkflows, type WorkflowFile } from "./format.ts";
import { renderWorkflowRun } from "./renderer.ts";
import { formatRunLine, runWorkflow, WORKFLOW_RUN_CUSTOM_TYPE, type WorkflowRunDetails } from "./run.ts";

export const WORKFLOW_RUN_TOOL_NAME = "workflow_run";
const STATUS_KEY = "workflow";

export interface WorkflowsExtensionOptions {
	/** Directory that holds the user's `workflows/` directory. Default: the agent directory. */
	agentDir?: string;
}

/** `run <name> a=1 "b=x y" --dry` as tokens, honoring double and single quotes. */
export function tokenizeArgs(args: string): string[] {
	const tokens: string[] = [];
	for (const match of args.matchAll(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)) {
		tokens.push(match[0].replace(/"([^"]*)"|'([^']*)'/g, (_whole, double, single) => double ?? single ?? ""));
	}
	return tokens;
}

export interface ParsedRunArgs {
	name: string;
	params: Record<string, string>;
	dry: boolean;
}

/** Parse `<name> [k=v ...] [--dry]`. */
export function parseRunArgs(tokens: readonly string[]): ParsedRunArgs | { error: string } {
	const [name, ...rest] = tokens;
	if (!name) return { error: "Usage: /workflow run <name> [param=value ...] [--dry]" };
	const params: Record<string, string> = {};
	let dry = false;
	for (const token of rest) {
		if (token === "--dry") {
			dry = true;
			continue;
		}
		const eq = token.indexOf("=");
		if (eq <= 0) return { error: `Expected param=value, got "${token}"` };
		params[token.slice(0, eq)] = token.slice(eq + 1);
	}
	return { name, params, dry };
}

function describeParams(file: WorkflowFile): string {
	const params = Object.entries(file.manifest?.params ?? {});
	if (params.length === 0) return "";
	return ` Params: ${params
		.filter(([, param]) => !param.secret)
		.map(([name, param]) => `${name} (${param.type}${param.required ? ", required" : ""})`)
		.join(", ")}`;
}

/** Description of the `workflow_run` tool, listing the valid workflows. */
export function createWorkflowRunDescription(workflows: readonly WorkflowFile[]): string {
	const lines = workflows
		.filter((file) => file.manifest)
		.map((file) => `- ${file.name}: ${file.manifest?.description}${describeParams(file)}`);
	return [
		"Run a saved workflow: a script that calls tools in fixed steps, with parameters. When a workflow matches the task, run it instead of repeating its steps by hand. `dry: true` does not call tools that may change anything; they return a stub. The result lists the steps, tool calls, and output.",
		"Workflows:",
		...lines,
	].join("\n");
}

const workflowRunSchema = Type.Object({
	name: Type.String({ description: "Workflow name." }),
	params: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Parameter values by name. Lists may be arrays or comma-separated strings.",
		}),
	),
	dry: Type.Optional(Type.Boolean({ description: "Dry run: tools that may write are not called." })),
});

/** Replace secrets in every string of `value`. */
function maskDeep(value: unknown, mask: (text: string) => string): unknown {
	if (typeof value === "string") return mask(value);
	if (Array.isArray(value)) return value.map((item) => maskDeep(item, mask));
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskDeep(item, mask)]));
	}
	return value;
}

/** A tool context whose calls run through the command's `executeTool()` under `parentToolCallId`. */
function createCommandToolContext(ctx: ExtensionCommandContext, parentToolCallId: string): ExtensionToolContext {
	// A prototype keeps the context's lazy getters working, which a spread would freeze.
	return Object.create(ctx, {
		executeTool: {
			value: (name: string, args: unknown, options?: Parameters<ExtensionToolContext["executeTool"]>[2]) =>
				ctx.executeTool(name, args, { ...options, parentToolCallId }),
		},
	}) as ExtensionToolContext;
}

export function createWorkflowsExtension(options: WorkflowsExtensionOptions = {}): ExtensionFactory {
	return (akramcode: ExtensionAPI) => {
		/** Maskers of running `workflow_run` calls, to mask secrets in their recorded nested calls. */
		const maskers = new Map<string, (text: string) => string>();
		let toolRegistered = false;

		const discover = (ctx: ExtensionContext) =>
			discoverWorkflows({ cwd: ctx.cwd, agentDir: options.agentDir, projectTrusted: ctx.isProjectTrusted() });
		const getAnnotations = (name: string): ToolAnnotations | undefined =>
			akramcode.getAllTools().find((tool) => tool.name === name)?.annotations;
		const mayWrite = (file: WorkflowFile) =>
			(file.manifest?.tools ?? []).filter((name) => getAnnotations(name)?.readOnlyHint !== true);

		akramcode.registerMessageRenderer<WorkflowRunDetails>(
			WORKFLOW_RUN_CUSTOM_TYPE,
			(message, renderOptions, theme) =>
				message.details
					? renderWorkflowRun(message.details, renderOptions.expanded, renderOptions.outputPad, theme)
					: undefined,
		);

		const registerTool = (workflows: readonly WorkflowFile[]) => {
			const valid = workflows.filter((file) => file.manifest);
			if (valid.length === 0 && !toolRegistered) return;
			toolRegistered = true;
			akramcode.registerTool<typeof workflowRunSchema, WorkflowRunDetails | undefined>({
				name: WORKFLOW_RUN_TOOL_NAME,
				label: "workflow",
				description: createWorkflowRunDescription(valid),
				promptSnippet: "Run a saved workflow (a fixed, parameterized tool script)",
				parameters: workflowRunSchema,
				// Scripts cannot start workflows, as they cannot start codemode scripts.
				exposure: valid.length > 0 ? "model-only" : "hidden",
				executionMode: "sequential",
				async execute(toolCallId, params, signal, onUpdate, ctx) {
					const file = discover(ctx).workflows.find((candidate) => candidate.name === params.name);
					if (!file) throw new Error(`Unknown workflow "${params.name}"`);
					if (!file.manifest) throw new Error(`Workflow "${file.name}" is invalid: ${file.errors.join("; ")}`);
					const dry = params.dry === true;
					const writers = mayWrite(file);
					if (!dry && ctx.hasUI && writers.length > 0) {
						const approved = await ctx.ui.confirm(
							`Run workflow ${file.name}?`,
							`It may call tools that change things: ${writers.join(", ")}`,
						);
						if (!approved) throw new Error(`The user did not approve running workflow "${file.name}"`);
					}
					try {
						const result = await runWorkflow(file, {
							params: params.params ?? {},
							dry,
							ctx,
							runId: toolCallId,
							getAnnotations,
							signal,
							onMask: (mask) => maskers.set(toolCallId, mask),
							onUpdate: (details) => onUpdate?.({ content: [], details: { ...details } }),
						});
						return {
							content: [{ type: "text", text: result.text }],
							details: result.details,
							...(result.usage ? { usage: result.usage } : {}),
							...(result.details.status === "completed" ? {} : { isError: true }),
						};
					} catch (error) {
						maskers.delete(toolCallId);
						throw error;
					}
				},
				renderCall(args, theme) {
					const dry = args.dry ? theme.fg("muted", " (dry run)") : "";
					return new Text(`${theme.fg("toolTitle", theme.bold("workflow"))} ${args.name ?? ""}${dry}`, 0, 0);
				},
				renderResult(result, renderOptions, theme) {
					if (!result.details) {
						const first = result.content[0];
						return new Text(first?.type === "text" ? first.text : "", 0, 0);
					}
					return renderWorkflowRun(result.details, renderOptions.expanded, 0, theme);
				},
			});
		};

		// Nested calls of workflow_run are recorded on its result message; mask secrets in them.
		akramcode.on("message_end", (event) => {
			const message = event.message;
			if (message.role !== "toolResult") return;
			const mask = maskers.get(message.toolCallId);
			if (!mask) return;
			maskers.delete(message.toolCallId);
			if (!message.nestedCalls) return;
			const calls: NestedToolCallRecord[] = message.nestedCalls.calls.map((call) => ({
				...call,
				...(call.arguments
					? { arguments: maskDeep(call.arguments, mask) as NestedToolCallRecord["arguments"] }
					: {}),
				...(call.error ? { error: mask(call.error) } : {}),
			}));
			return { message: { ...message, nestedCalls: { ...message.nestedCalls, calls } } };
		});

		akramcode.on("session_start", (_event, ctx) => {
			registerTool(discover(ctx).workflows);
		});

		const runFromCommand = async (
			ctx: ExtensionCommandContext,
			file: WorkflowFile,
			params: Record<string, string>,
			dry: boolean,
		) => {
			const runId = `workflow:${file.name}:${randomBytes(4).toString("hex")}`;
			const setStatus = (details: WorkflowRunDetails) => ctx.ui.setStatus(STATUS_KEY, formatRunLine(details));
			try {
				const result = await runWorkflow(file, {
					params,
					dry,
					ctx: createCommandToolContext(ctx, runId),
					runId,
					getAnnotations,
					onUpdate: (details) => {
						if (details.status === "running") setStatus(details);
					},
				});
				akramcode.sendMessage(
					{ customType: WORKFLOW_RUN_CUSTOM_TYPE, content: result.text, display: true, details: result.details },
					{ triggerTurn: false },
				);
			} catch (error) {
				ctx.ui.notify(`workflow ${file.name}: ${error instanceof Error ? error.message : String(error)}`, "error");
			} finally {
				ctx.ui.setStatus(STATUS_KEY, undefined);
			}
		};

		const findFile = (ctx: ExtensionCommandContext, name: string): WorkflowFile | undefined => {
			const { workflows } = discover(ctx);
			const file = workflows.find((candidate) => candidate.name === name);
			if (!file) {
				const names = workflows.map((candidate) => candidate.name);
				ctx.ui.notify(
					`Unknown workflow "${name}".${names.length > 0 ? ` Workflows: ${names.join(", ")}` : " No workflows found."}`,
					"warning",
				);
			}
			return file;
		};

		const check = (ctx: ExtensionCommandContext, file: WorkflowFile) => {
			const callable = new Set(ctx.tools.map((tool) => tool.name));
			const registered = akramcode.getAllTools().map((tool) => tool.name);
			const result = checkWorkflow(file, [...callable], registered);
			ctx.ui.notify(formatCheckResult(file.name, result), result.status === "ok" ? "info" : "warning");
		};

		const pick = async (ctx: ExtensionCommandContext) => {
			const { workflows, diagnostics } = discover(ctx);
			for (const diagnostic of diagnostics) ctx.ui.notify(`${diagnostic.path}: ${diagnostic.message}`, "warning");
			if (workflows.length === 0) {
				ctx.ui.notify("No workflows. Add <name>.workflow.js files; see docs/workflows.md.", "info");
				return;
			}
			const items = workflows.map(
				(file) =>
					`${file.name}  ${file.manifest?.description ?? `(invalid: ${file.errors[0] ?? "unknown error"})`} · ${file.source}`,
			);
			const choice = await ctx.ui.select("Workflows", items);
			const file = choice === undefined ? undefined : workflows[items.indexOf(choice)];
			if (!file) return;
			const action = await ctx.ui.select(file.name, ["Run", "Dry run", "Check"]);
			if (action === "Check") check(ctx, file);
			else if (action === "Run" || action === "Dry run") await runFromCommand(ctx, file, {}, action === "Dry run");
		};

		akramcode.registerCommand("workflow", {
			description: "Run or check a workflow: /workflow [run <name> [k=v ...] [--dry] | check <name>]",
			handler: async (args, ctx) => {
				const [subcommand, ...rest] = tokenizeArgs(args.trim());
				if (!subcommand) {
					await pick(ctx);
					return;
				}
				if (subcommand === "check") {
					const file = rest[0] ? findFile(ctx, rest[0]) : undefined;
					if (!rest[0]) ctx.ui.notify("Usage: /workflow check <name>", "warning");
					if (file) check(ctx, file);
					return;
				}
				if (subcommand !== "run") {
					ctx.ui.notify("Usage: /workflow [run <name> [param=value ...] [--dry] | check <name>]", "warning");
					return;
				}
				const parsed = parseRunArgs(rest);
				if ("error" in parsed) {
					ctx.ui.notify(parsed.error, "warning");
					return;
				}
				const file = findFile(ctx, parsed.name);
				if (!file) return;
				if (!file.manifest) {
					ctx.ui.notify(`Workflow ${file.name} is invalid: ${file.errors.join("; ")}`, "error");
					return;
				}
				await runFromCommand(ctx, file, parsed.params, parsed.dry);
			},
		});
	};
}

export default createWorkflowsExtension();
