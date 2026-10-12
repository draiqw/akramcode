/**
 * Runs a workflow file on top of codemode's `executeCodemode()`.
 *
 * The script runs in the codemode sandbox with these globals next to codemode's own:
 * - `params`: the parameter values, checked and converted to their declared types.
 * - `step(id, fn)`: runs `fn` as a named step; the run record lists steps with status and duration.
 * - `llm({ prompt, input?, schema?, model? })`: one model call without tools.
 * - `check(condition, message)`: fails the run (and the current step) when `condition` is falsy.
 * - `ask({ question, options?, default? })`: asks the user; without a UI it returns `default` or
 *   ends the run with `needs_input`.
 *
 * Tool calls go through the session's tool pipeline. Only tools listed in the manifest can be
 * called, and a result with `isError` rejects. With `dry`, tools without `readOnlyHint: true` are
 * not called and resolve to `{ dry_run: true, tool, arguments }`. Secret parameter values are
 * replaced with `***<name>***` in everything the run records.
 */

import type { AgentToolResult } from "@akramcode/agent-core";
import type { Api, Message, Model, TextContent, Usage } from "@akramcode/ai";
import type { CodemodeResult, CodemodeTool } from "@akramcode/codemode";
import { toCodemodeIdentifier } from "@akramcode/codemode/declarations";
import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";
import type { ExtensionToolContext, ToolAnnotations } from "../../core/extensions/types.ts";
import { combineUsage } from "../../core/usage-totals.ts";
import { loadCodemodeExecutor } from "../codemode/execute.lazy.ts";
import type { CodemodeNestedCall, CodemodeToolDetails } from "../codemode/tool.ts";
import { askQuestions } from "../question/index.ts";
import {
	matchesParamType,
	type WorkflowFile,
	type WorkflowManifest,
	type WorkflowParam,
	type WorkflowParamValue,
	type WorkflowSource,
} from "./format.ts";

export const WORKFLOW_RUN_CUSTOM_TYPE = "workflow-run";

/** Characters of script output kept in the run record. */
const MAX_OUTPUT_CHARS = 20_000;

const MIN_SECRET_LENGTH = 6;

export type WorkflowStepStatus = "running" | "ok" | "error";

export interface WorkflowStep {
	id: string;
	status: WorkflowStepStatus;
	durationMs?: number;
	error?: string;
}

export type WorkflowRunStatus = "running" | "completed" | "failed" | "needs_input" | "cancelled";

/** The run record: custom message `details` of `/workflow run`, and the `workflow_run` tool result `details`. */
export interface WorkflowRunDetails {
	name: string;
	source: WorkflowSource;
	dry: boolean;
	status: WorkflowRunStatus;
	/** Parameter values; secrets are masked. */
	params: Record<string, WorkflowParamValue>;
	steps: WorkflowStep[];
	/** Nested tool calls; `stubbed` calls were not run (dry run). Arguments and errors are masked. */
	calls: CodemodeNestedCall[];
	durationMs: number;
	/** Script output and return value, masked and truncated. */
	output?: string;
	/** Why the run did not complete, masked. */
	error?: string;
}

export interface WorkflowRunOptions {
	/** Parameter values: strings from `/workflow run k=v`, or JSON values from the `workflow_run` tool. */
	params: Record<string, unknown>;
	dry: boolean;
	/** Session context with `tools` and `executeTool()`. */
	ctx: ExtensionToolContext;
	/** Id for the run's nested call rows. */
	runId: string;
	getAnnotations: (toolName: string) => ToolAnnotations | undefined;
	signal?: AbortSignal;
	onUpdate?: (details: WorkflowRunDetails) => void;
}

export interface WorkflowRunResult {
	details: WorkflowRunDetails;
	/** Model-facing summary. */
	text: string;
	/** Usage of the `llm()` calls. */
	usage?: Usage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Strings as is, other values as JSON. */
function valueText(value: unknown): string {
	if (typeof value === "string") return value;
	return JSON.stringify(value) ?? String(value);
}

function formatDuration(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const TRUE_WORDS = new Set(["true", "yes", "1", "on"]);
const FALSE_WORDS = new Set(["false", "no", "0", "off"]);

/** Convert a supplied value to the parameter's type, or throw. Lists accept comma-separated strings. */
export function coerceParamValue(name: string, param: WorkflowParam, value: unknown): WorkflowParamValue {
	if (matchesParamType(param.type, value)) return value;
	const fail = () => new Error(`Parameter ${name} must be a ${param.type}, got ${JSON.stringify(value)}`);
	switch (param.type) {
		case "string":
			if (typeof value === "number" || typeof value === "boolean") return String(value);
			throw fail();
		case "number": {
			const number = typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
			if (!Number.isFinite(number)) throw fail();
			return number;
		}
		case "boolean": {
			const word = typeof value === "string" ? value.trim().toLowerCase() : "";
			if (TRUE_WORDS.has(word)) return true;
			if (FALSE_WORDS.has(word)) return false;
			throw fail();
		}
		case "list":
			if (typeof value === "string") {
				return value
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean);
			}
			if (Array.isArray(value)) return value.map((item) => valueText(item));
			throw fail();
	}
}

export interface ResolvedParams {
	values: Record<string, WorkflowParamValue>;
	/** Secret values by parameter name. */
	secrets: Map<string, string>;
}

/**
 * Parameter values for a run: supplied values, then defaults; secrets from their environment
 * variable. A missing required value is asked for with `ask` when given, otherwise it fails.
 */
export async function resolveWorkflowParams(
	manifest: WorkflowManifest,
	supplied: Record<string, unknown>,
	env: Readonly<Record<string, string | undefined>>,
	ask?: (name: string, param: WorkflowParam) => Promise<string | undefined>,
): Promise<ResolvedParams> {
	for (const name of Object.keys(supplied)) {
		if (!Object.hasOwn(manifest.params, name)) throw new Error(`Unknown parameter ${name}`);
	}
	const values: Record<string, WorkflowParamValue> = {};
	const secrets = new Map<string, string>();
	for (const [name, param] of Object.entries(manifest.params)) {
		if (param.secret) {
			if (supplied[name] !== undefined) throw new Error(`Secret parameter ${name} is read from $${param.env}`);
			const value = param.env ? env[param.env] : undefined;
			if (value === undefined || value === "") {
				if (param.required) throw new Error(`Secret parameter ${name} needs the environment variable ${param.env}`);
				continue;
			}
			// Masking a very short value would replace it everywhere it occurs and reveal it.
			if (value.length < MIN_SECRET_LENGTH) {
				throw new Error(`Secret parameter ${name} is shorter than ${MIN_SECRET_LENGTH} characters`);
			}
			values[name] = value;
			secrets.set(name, value);
			continue;
		}
		let value = supplied[name] ?? param.default;
		if (value === undefined && param.required) {
			value = await ask?.(name, param);
			if (value === undefined) throw new Error(`Missing required parameter ${name}`);
		}
		if (value !== undefined) values[name] = coerceParamValue(name, param, value);
	}
	return { values, secrets };
}

/** Replace each secret value, also its JSON-escaped, URL-encoded, and base64 forms, with `***<name>***`. */
export function createMasker(secrets: ReadonlyMap<string, string>): (text: string) => string {
	const entries = [...secrets]
		.filter(([, value]) => value.length > 0)
		.flatMap(([name, value]): Array<[string, string]> => {
			const forms = new Set([
				value,
				JSON.stringify(value).slice(1, -1),
				encodeURIComponent(value),
				Buffer.from(value).toString("base64").replace(/=+$/, ""),
			]);
			return [...forms].map((form): [string, string] => [name, form]);
		})
		.sort((a, b) => b[1].length - a[1].length);
	if (entries.length === 0) return (text) => text;
	return (text) => {
		let masked = text;
		for (const [name, value] of entries) masked = masked.split(value).join(`***${name}***`);
		return masked;
	};
}

/**
 * The workflow body with a one-line prelude that defines `params`, `check`, and `step`. The
 * manifest comment left at least one line break, so the prelude takes its place and line numbers
 * of the script stay the same.
 */
export function buildWorkflowScript(body: string): string {
	const prelude =
		"const params = Object.freeze(await __workflow.params());" +
		' const check = (condition, message) => { if (!condition) throw new Error("check failed: " + (message ?? "condition is false")); };' +
		' const step = async (id, fn) => { if (typeof fn !== "function") throw new TypeError("step(id, fn) expects a function"); const index = await __workflow.stepStart({ id: String(id) });' +
		" try { const value = await fn(); await __workflow.stepEnd({ index, ok: true }); return value; }" +
		" catch (error) { await __workflow.stepEnd({ index, ok: false, error: error instanceof Error ? error.message : String(error) }); throw error; } };";
	return prelude + body;
}

interface LlmRequest {
	prompt: string;
	input: Record<string, unknown>;
	schema?: Record<string, unknown>;
	model?: string;
}

function parseLlmRequest(request: unknown): LlmRequest {
	const shape = "llm() expects { prompt: string, input?: object, schema?: object, model?: string }";
	if (!isRecord(request) || typeof request.prompt !== "string") throw new Error(shape);
	if (request.input !== undefined && !isRecord(request.input)) throw new Error(`${shape}: input must be an object`);
	if (request.schema !== undefined && !isRecord(request.schema)) throw new Error(`${shape}: schema must be an object`);
	if (request.model !== undefined && typeof request.model !== "string") {
		throw new Error(`${shape}: model must be "provider/id"`);
	}
	return {
		prompt: request.prompt,
		input: (request.input as Record<string, unknown> | undefined) ?? {},
		...(request.schema ? { schema: request.schema as Record<string, unknown> } : {}),
		...(request.model ? { model: request.model as string } : {}),
	};
}

/** `{name}` placeholders replaced with `input.name`; unknown names stay as written. */
export function fillPrompt(prompt: string, input: Record<string, unknown>): string {
	return prompt.replace(/\{([A-Za-z_$][\w$]*)\}/g, (whole, key: string) =>
		Object.hasOwn(input, key) ? valueText(input[key]) : whole,
	);
}

/** Parse a model reply as JSON, accepting a surrounding code fence, and check it against `schema`. */
export function parseJsonReply(text: string, schema: Record<string, unknown>): unknown {
	const fenced = text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
	let value: unknown;
	try {
		value = JSON.parse(fenced ? fenced[1] : text);
	} catch (error) {
		throw new Error(`llm() reply is not valid JSON: ${errorMessage(error)}`);
	}
	const validator = Compile(schema as TSchema);
	if (!validator.Check(value)) {
		const problems = validator
			.Errors(value)
			.slice(0, 5)
			.map((error) => `${error.instancePath || "/"} ${error.message}`);
		throw new Error(`llm() reply does not match the schema: ${problems.join("; ")}`);
	}
	return value;
}

function resolveModel(ctx: ExtensionToolContext, ref: string | undefined): Model<Api> {
	if (!ref) {
		if (!ctx.model) throw new Error('llm() needs a model: select one, or pass model: "provider/id"');
		return ctx.model;
	}
	const slash = ref.indexOf("/");
	const model = slash > 0 ? ctx.modelRegistry.find(ref.slice(0, slash), ref.slice(slash + 1)) : undefined;
	if (!model) throw new Error(`llm(): unknown model "${ref}", expected "provider/id"`);
	return model;
}

export async function runWorkflow(file: WorkflowFile, options: WorkflowRunOptions): Promise<WorkflowRunResult> {
	const { manifest, body } = file;
	if (!manifest || body === undefined) throw new Error(`Workflow ${file.name} is invalid: ${file.errors.join("; ")}`);
	const { ctx, dry, signal } = options;
	const startedAt = performance.now();

	const resolved = await resolveWorkflowParams(
		manifest,
		options.params,
		process.env,
		ctx.hasUI ? (name, param) => ctx.ui.input(param.label ?? name, param.description) : undefined,
	);
	const mask = createMasker(resolved.secrets);
	const maskedParams: Record<string, WorkflowParamValue> = {};
	for (const [name, value] of Object.entries(resolved.values)) {
		maskedParams[name] = resolved.secrets.has(name) ? `***${name}***` : value;
	}

	const details: WorkflowRunDetails = {
		name: file.name,
		source: file.source,
		dry,
		status: "running",
		params: maskedParams,
		steps: [],
		calls: [],
		durationMs: 0,
	};
	const stepStartedAt: number[] = [];
	const publish = () => {
		details.durationMs = performance.now() - startedAt;
		options.onUpdate?.(details);
	};
	let needsInput: string | undefined;
	let usage: Usage | undefined;

	const allowed = new Set(manifest.tools);
	const globals: CodemodeTool[] = [
		{ name: "__workflow.params", execute: () => resolved.values },
		{
			name: "__workflow.stepStart",
			execute: (args) => {
				const id = mask(isRecord(args) && typeof args.id === "string" ? args.id : "step");
				details.steps.push({ id, status: "running" });
				stepStartedAt.push(performance.now());
				publish();
				return details.steps.length - 1;
			},
		},
		{
			name: "__workflow.stepEnd",
			execute: (args) => {
				if (!isRecord(args) || typeof args.index !== "number") return;
				const step = details.steps[args.index];
				if (!step) return;
				step.status = args.ok === true ? "ok" : "error";
				step.durationMs = performance.now() - (stepStartedAt[args.index] ?? startedAt);
				if (typeof args.error === "string") step.error = mask(args.error);
				publish();
			},
		},
		{
			name: "llm",
			execute: async (request, { signal: callSignal }) => {
				const { prompt, input, schema, model: ref } = parseLlmRequest(request);
				const model = resolveModel(ctx, ref);
				// Models follow a format request in the user message more reliably than in the system prompt.
				const format = schema
					? `Reply with only a JSON value that matches this JSON Schema, with no code fence or other text:\n${JSON.stringify(schema)}`
					: undefined;
				const messages: Message[] = [
					{
						role: "user",
						content: format ? `${fillPrompt(prompt, input)}\n\n${format}` : fillPrompt(prompt, input),
						timestamp: Date.now(),
					},
				];
				// A reply that is not valid JSON gets one retry with the parse error.
				for (let attempt = 1; ; attempt++) {
					const message = await ctx.modelRegistry
						.streamSimple(
							model,
							{ ...(format ? { systemPrompt: format } : {}), messages },
							{ signal: callSignal },
						)
						.result();
					if (message.usage) usage = usage ? combineUsage(usage, message.usage) : message.usage;
					if (message.stopReason === "error" || message.stopReason === "aborted") {
						throw new Error(`llm() failed: ${message.errorMessage ?? message.stopReason}`);
					}
					const text = message.content
						.filter((block): block is TextContent => block.type === "text")
						.map((block) => block.text)
						.join("");
					if (!schema) return text;
					try {
						return parseJsonReply(text, schema);
					} catch (error) {
						if (attempt >= 2) throw error;
						messages.push(message, {
							role: "user",
							content: `${errorMessage(error)}. ${format}`,
							timestamp: Date.now(),
						});
					}
				}
			},
		},
		{
			name: "ask",
			execute: async (request, { signal: callSignal }) => {
				const shape = "ask() expects { question: string, options?: string[], default?: string }";
				if (!isRecord(request) || typeof request.question !== "string") throw new Error(shape);
				const { question } = request;
				const choices = request.options;
				if (choices !== undefined && !(Array.isArray(choices) && choices.every((c) => typeof c === "string"))) {
					throw new Error(shape);
				}
				const fallback = request.default === undefined ? undefined : valueText(request.default);
				if (!ctx.hasUI) {
					if (fallback !== undefined) return fallback;
					needsInput = question;
					throw new Error(`needs input: ${question}`);
				}
				if (choices && choices.length > 0) {
					const result = await askQuestions(
						ctx,
						[{ question, options: choices.map((label) => ({ label })) }],
						callSignal,
					);
					if (!result) throw new Error(`ask() was cancelled: ${question}`);
					const answer = result.answers[0];
					return answer?.selected[0] ?? answer?.custom ?? fallback ?? "";
				}
				const reply = await ctx.ui.input(question, fallback);
				if (reply === undefined) throw new Error(`ask() was cancelled: ${question}`);
				return reply.trim() || fallback || "";
			},
		},
	];

	let sandboxResult: CodemodeResult | undefined;
	const { executeCodemode } = await loadCodemodeExecutor();
	const codemodeResult: AgentToolResult<CodemodeToolDetails> = await executeCodemode(
		options.runId,
		{ code: buildWorkflowScript(body) },
		signal,
		(update) => {
			details.calls = update.details.calls.map((call) => maskCall(call, mask));
			publish();
		},
		ctx,
		{
			globals,
			rejectToolErrors: true,
			redact: mask,
			beforeToolCall: async (tool, args) => {
				if (!allowed.has(tool.name)) {
					throw new Error(`tools.${toCodemodeIdentifier(tool.name)} is not in the workflow's "tools" list`);
				}
				// Background task notifications and subagent transcripts are recorded outside the run, unmasked.
				if (resolved.secrets.size > 0) {
					if (tool.name === "agent") throw new Error("A workflow with secret parameters cannot start subagents");
					if (isRecord(args) && args.run_in_background === true) {
						throw new Error("A workflow with secret parameters cannot run tools in the background");
					}
				}
				if (dry && options.getAnnotations(tool.name)?.readOnlyHint !== true) {
					return { value: { dry_run: true, tool: tool.name, arguments: args } };
				}
				return undefined;
			},
			onResult: (result) => {
				sandboxResult = result;
			},
		},
	);
	details.calls = codemodeResult.details.calls.map((call) => maskCall(call, mask));
	for (const step of details.steps) {
		if (step.status === "running") step.status = "error";
	}

	const result = sandboxResult;
	const outputParts = (result?.output ?? []).flatMap((item) => (item.type === "text" ? [item.text] : []));
	if (result?.ok && result.value !== undefined) outputParts.push(valueText(result.value));
	const output = mask(outputParts.join("\n"));
	if (output) {
		details.output =
			output.length > MAX_OUTPUT_CHARS ? `${output.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]` : output;
	}
	if (result?.ok) {
		details.status = "completed";
	} else if (
		needsInput !== undefined &&
		result &&
		!result.ok &&
		result.error.message.includes(`needs input: ${needsInput}`)
	) {
		details.status = "needs_input";
		details.error = mask(`needs input: ${needsInput}`);
	} else if (result && !result.ok && result.error.kind === "aborted") {
		details.status = "cancelled";
		details.error = "cancelled";
	} else {
		details.status = "failed";
		const message = result && !result.ok ? result.error.message : "the sandbox did not run";
		details.error = mask(message);
	}
	details.durationMs = performance.now() - startedAt;
	options.onUpdate?.(details);
	return { details, text: formatRunText(details), ...(usage ? { usage } : {}) };
}

function maskCall(call: CodemodeNestedCall, mask: (text: string) => string): CodemodeNestedCall {
	return { ...call, args: mask(call.args), ...(call.error ? { error: mask(call.error) } : {}) };
}

/** The step a failed run stopped at. */
export function failedStep(details: WorkflowRunDetails): WorkflowStep | undefined {
	return details.steps.findLast((step) => step.status === "error");
}

/** One line: `workflow <name> completed · 3 steps · 1.2s`, with `(dry run)` and the failing step. */
export function formatRunLine(details: WorkflowRunDetails): string {
	const parts = [`workflow ${details.name}${details.dry ? " (dry run)" : ""}`];
	if (details.status === "running") {
		const current = details.steps.findLast((step) => step.status === "running");
		parts.push(current ? `step ${details.steps.indexOf(current) + 1} ${current.id}` : "starting");
		return parts.join(" · ");
	}
	const step = failedStep(details);
	const head = `${parts[0]} ${details.status.replace("_", " ")}`;
	const tail = [
		`${details.steps.length} step${details.steps.length === 1 ? "" : "s"}`,
		formatDuration(details.durationMs),
	];
	if (details.status !== "completed" && details.error) {
		tail.unshift(`${step ? `${step.id}: ` : ""}${details.error.split("\n")[0]}`);
	}
	return `${head} · ${tail.join(" · ")}`;
}

/** The details below the run line: steps, tool calls, and output. */
export function formatRunBody(details: WorkflowRunDetails): string[] {
	const lines: string[] = [];
	const params = Object.entries(details.params);
	if (params.length > 0)
		lines.push(`params: ${params.map(([name, value]) => `${name}=${valueText(value)}`).join(" ")}`);
	for (const [index, step] of details.steps.entries()) {
		const duration = step.durationMs === undefined ? "" : ` ${formatDuration(step.durationMs)}`;
		lines.push(
			`${index + 1}. ${step.id} ${step.status}${duration}${step.error ? ` ${step.error.split("\n")[0]}` : ""}`,
		);
	}
	for (const call of details.calls) {
		const status = call.stubbed ? "dry run" : call.status;
		lines.push(`  ${call.name} ${call.args} ${status}${call.error ? ` ${call.error.split("\n")[0]}` : ""}`);
	}
	if (details.output) lines.push("", details.output);
	return lines;
}

/** Model-facing text of a run. */
export function formatRunText(details: WorkflowRunDetails): string {
	const lines = [formatRunLine(details)];
	if (details.steps.length > 0) {
		lines.push(
			`Steps: ${details.steps.map((step) => `${step.id} ${step.status}${step.durationMs === undefined ? "" : ` ${formatDuration(step.durationMs)}`}`).join(", ")}`,
		);
	}
	if (details.calls.length > 0) {
		lines.push(
			`Tool calls: ${details.calls.map((call) => `${call.name} (${call.stubbed ? "dry run, not called" : call.status})`).join(", ")}`,
		);
	}
	if (details.error && details.status !== "completed") lines.push(`Error: ${details.error}`);
	if (details.output) lines.push(`Output:\n${details.output}`);
	return lines.join("\n");
}
