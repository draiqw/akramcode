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
import { getKeybindings, Text } from "@akramcode/tui";
import { Type } from "typebox";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionFactory,
	ExtensionToolContext,
	ToolAnnotations,
} from "../../core/extensions/types.ts";
import { writeRawStdout } from "../../core/output-guard.ts";
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

/**
 * Show a command's message. Print mode has no UI, so it writes to stdout, or to stderr for
 * problems; errors also set a failing exit code.
 */
function report(ctx: ExtensionCommandContext, text: string, level: "info" | "warning" | "error"): void {
	if (ctx.mode !== "print" && ctx.mode !== "json") {
		ctx.ui.notify(text, level);
		return;
	}
	// JSON mode keeps stdout for its event stream.
	if (level === "info" && ctx.mode === "print") writeRawStdout(`${text}\n`);
	else process.stderr.write(`${text}\n`);
	if (level === "error") process.exitCode = 1;
}

/**
 * A tool context whose calls run through the command's `executeTool()` under `parentToolCallId`.
 * Its dialogs count themselves in `openDialogs`, so the interrupt key closes a dialog without also
 * cancelling the run.
 */
function createCommandToolContext(
	ctx: ExtensionCommandContext,
	parentToolCallId: string,
	openDialogs: { count: number },
): ExtensionToolContext {
	const counted =
		<A extends unknown[], R>(dialog: (...args: A) => Promise<R>) =>
		async (...args: A): Promise<R> => {
			openDialogs.count++;
			try {
				return await dialog(...args);
			} finally {
				openDialogs.count--;
			}
		};
	const ui = Object.create(ctx.ui, {
		input: { value: counted(ctx.ui.input.bind(ctx.ui)) },
		select: { value: counted(ctx.ui.select.bind(ctx.ui)) },
		confirm: { value: counted(ctx.ui.confirm.bind(ctx.ui)) },
		editor: { value: counted(ctx.ui.editor.bind(ctx.ui)) },
		custom: { value: counted(ctx.ui.custom.bind(ctx.ui)) },
	});
	// A prototype keeps the context's lazy getters working, which a spread would freeze.
	return Object.create(ctx, {
		ui: { value: ui },
		executeTool: {
			value: (name: string, args: unknown, options?: Parameters<ExtensionToolContext["executeTool"]>[2]) =>
				ctx.executeTool(name, args, { ...options, parentToolCallId }),
		},
	}) as ExtensionToolContext;
}

export function createWorkflowsExtension(options: WorkflowsExtensionOptions = {}): ExtensionFactory {
	return (akramcode: ExtensionAPI) => {
		let toolRegistered = false;

		const discover = (ctx: ExtensionContext) => discoverWorkflows({ cwd: ctx.cwd, agentDir: options.agentDir });
		// MCP servers declare their own annotations, so their read-only claims are not trusted: a server
		// could mark a writing tool read-only to skip the confirmation and run during dry runs.
		const getAnnotations = (name: string): ToolAnnotations | undefined => {
			const annotations = akramcode.getAllTools().find((tool) => tool.name === name)?.annotations;
			return name.startsWith("mcp__") && annotations ? { ...annotations, readOnlyHint: false } : annotations;
		};
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
						const shown = Object.entries(params.params ?? {})
							.filter(([name]) => !file.manifest?.params[name]?.secret)
							.map(([name, value]) => `${name}=${typeof value === "string" ? value : JSON.stringify(value)}`);
						const approved = await ctx.ui.confirm(
							`Run workflow ${file.name}?`,
							[
								`It may call tools that change things: ${writers.join(", ")}`,
								...(shown.length > 0 ? [`Parameters: ${shown.join(" ")}`] : []),
							].join("\n"),
						);
						if (!approved) throw new Error(`The user did not approve running workflow "${file.name}"`);
					}
					const result = await runWorkflow(file, {
						params: params.params ?? {},
						dry,
						ctx,
						runId: toolCallId,
						getAnnotations,
						signal,
						onUpdate: (details) => onUpdate?.({ content: [], details: { ...details } }),
					});
					return {
						content: [{ type: "text", text: result.text }],
						details: result.details,
						...(result.usage ? { usage: result.usage } : {}),
						...(result.details.status === "completed" ? {} : { isError: true }),
					};
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

		akramcode.on("session_start", (_event, ctx) => {
			registerTool(discover(ctx).workflows);
		});

		const runFromCommand = async (
			ctx: ExtensionCommandContext,
			file: WorkflowFile,
			params: Record<string, string>,
			dry: boolean,
		) => {
			// Commands run at once even mid-turn; tool calls of the run must not interleave with the agent's.
			await ctx.waitForIdle();
			const runId = `workflow:${file.name}:${randomBytes(4).toString("hex")}`;
			const setStatus = (details: WorkflowRunDetails) => ctx.ui.setStatus(STATUS_KEY, formatRunLine(details));
			// No agent turn runs, so nothing else cancels the run: the interrupt key does.
			const controller = new AbortController();
			const openDialogs = { count: 0 };
			const stopListening = ctx.ui.onTerminalInput((data) => {
				if (openDialogs.count === 0 && getKeybindings().matches(data, "app.interrupt")) controller.abort();
				return undefined;
			});
			try {
				const result = await runWorkflow(file, {
					params,
					dry,
					ctx: createCommandToolContext(ctx, runId, openDialogs),
					runId,
					getAnnotations,
					signal: controller.signal,
					onUpdate: (details) => {
						if (details.status === "running") setStatus(details);
					},
				});
				akramcode.sendMessage(
					{ customType: WORKFLOW_RUN_CUSTOM_TYPE, content: result.text, display: true, details: result.details },
					{ triggerTurn: false },
				);
				if (ctx.mode === "print") {
					report(ctx, result.text, result.details.status === "completed" ? "info" : "error");
				}
			} catch (error) {
				report(ctx, `workflow ${file.name}: ${error instanceof Error ? error.message : String(error)}`, "error");
			} finally {
				stopListening();
				ctx.ui.setStatus(STATUS_KEY, undefined);
			}
		};

		const findFile = (ctx: ExtensionCommandContext, name: string): WorkflowFile | undefined => {
			const { workflows } = discover(ctx);
			const file = workflows.find((candidate) => candidate.name === name);
			if (!file) {
				const names = workflows.map((candidate) => candidate.name);
				report(
					ctx,
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
			report(
				ctx,
				formatCheckResult(file.name, result),
				result.status === "ok" ? "info" : result.status === "failed" ? "error" : "warning",
			);
		};

		const pick = async (ctx: ExtensionCommandContext) => {
			const { workflows, diagnostics } = discover(ctx);
			for (const diagnostic of diagnostics) report(ctx, `${diagnostic.path}: ${diagnostic.message}`, "warning");
			if (workflows.length === 0) {
				report(ctx, "No workflows. Add <name>.workflow.js files; see docs/workflows.md.", "info");
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
					if (!rest[0]) report(ctx, "Usage: /workflow check <name>", "warning");
					if (file) check(ctx, file);
					return;
				}
				if (subcommand !== "run") {
					report(ctx, "Usage: /workflow [run <name> [param=value ...] [--dry] | check <name>]", "warning");
					return;
				}
				const parsed = parseRunArgs(rest);
				if ("error" in parsed) {
					report(ctx, parsed.error, "warning");
					return;
				}
				const file = findFile(ctx, parsed.name);
				if (!file) return;
				if (!file.manifest) {
					report(ctx, `Workflow ${file.name} is invalid: ${file.errors.join("; ")}`, "error");
					return;
				}
				await runFromCommand(ctx, file, parsed.params, parsed.dry);
			},
		});
	};
}

export default createWorkflowsExtension();
