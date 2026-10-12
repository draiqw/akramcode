/**
 * Workflow files: `<name>.workflow.js`, a codemode script that starts with a manifest comment.
 *
 * ```js
 * /* @workflow {
 *   "description": "Summarize commits since a tag",
 *   "params": { "since": { "type": "string", "required": true } },
 *   "tools": ["bash"]
 * } *\/
 * const log = await step("git-log", () => tools.bash({ command: `git log --oneline ${params.since}..HEAD` }));
 * return log.output;
 * ```
 *
 * Files live in `<agentDir>/workflows/` and, for trusted projects, `<cwd>/.akramcode/workflows/`.
 * A project workflow cannot replace a user workflow of the same name.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getProjectWorkflowsDir, getUserWorkflowsDir } from "../../config.ts";

export const WORKFLOW_FILE_SUFFIX = ".workflow.js";
export const WORKFLOW_MANIFEST_TAG = "@workflow";

export type WorkflowParamType = "string" | "number" | "boolean" | "list";
export type WorkflowParamValue = string | number | boolean | string[];

export interface WorkflowParam {
	type: WorkflowParamType;
	required: boolean;
	default?: WorkflowParamValue;
	/** Short human label, used when asking for a missing value. */
	label?: string;
	description?: string;
	/** The value comes from the environment variable `env` and is masked in output and records. */
	secret: boolean;
	env?: string;
}

export interface WorkflowManifest {
	description: string;
	params: Record<string, WorkflowParam>;
	/** Tools the script may call, by registered name. */
	tools: string[];
}

export type WorkflowSource = "user" | "project";

/** A discovered workflow file. `manifest` and `body` are set when the file parsed without errors. */
export interface WorkflowFile {
	name: string;
	path: string;
	source: WorkflowSource;
	/** The full file text. */
	text: string;
	manifest?: WorkflowManifest;
	/** The script with the manifest comment replaced by its line breaks, so line numbers are unchanged. */
	body?: string;
	errors: string[];
}

export interface WorkflowDiagnostic {
	path: string;
	message: string;
}

export interface WorkflowDiscovery {
	workflows: WorkflowFile[];
	diagnostics: WorkflowDiagnostic[];
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const PARAM_TYPES: readonly WorkflowParamType[] = ["string", "number", "boolean", "list"];
const MANIFEST_KEYS = ["description", "params", "tools"];
const PARAM_KEYS = ["type", "required", "default", "label", "description", "secret", "env"];
/** Names that cannot be keys of the `params` object. */
const RESERVED_PARAM_NAMES = new Set(["__proto__", "constructor", "prototype"]);

export function isValidWorkflowName(name: string): boolean {
	return NAME_PATTERN.test(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` has the JS type of a parameter of `type`. */
export function matchesParamType(type: WorkflowParamType, value: unknown): value is WorkflowParamValue {
	if (type === "list") return Array.isArray(value) && value.every((item) => typeof item === "string");
	return typeof value === type;
}

function parseParam(name: string, raw: unknown, errors: string[]): WorkflowParam | undefined {
	const at = `params.${name}`;
	if (!IDENTIFIER_PATTERN.test(name) || RESERVED_PARAM_NAMES.has(name)) {
		errors.push(`${at}: parameter names must be JavaScript identifiers`);
		return undefined;
	}
	if (!isRecord(raw)) {
		errors.push(`${at} must be an object`);
		return undefined;
	}
	for (const key of Object.keys(raw)) {
		if (!PARAM_KEYS.includes(key)) errors.push(`${at}: unknown field "${key}"`);
	}
	const type = raw.type;
	if (typeof type !== "string" || !(PARAM_TYPES as readonly string[]).includes(type)) {
		errors.push(`${at}.type must be one of ${PARAM_TYPES.join(", ")}`);
		return undefined;
	}
	const param: WorkflowParam = {
		type: type as WorkflowParamType,
		required: raw.required === true,
		secret: raw.secret === true,
	};
	for (const key of ["required", "secret"] as const) {
		if (raw[key] !== undefined && typeof raw[key] !== "boolean") errors.push(`${at}.${key} must be a boolean`);
	}
	for (const key of ["label", "description", "env"] as const) {
		const value = raw[key];
		if (value === undefined) continue;
		if (typeof value !== "string" || !value.trim()) errors.push(`${at}.${key} must be a non-empty string`);
		else param[key] = value;
	}
	if (raw.default !== undefined) {
		if (!matchesParamType(param.type, raw.default)) {
			errors.push(`${at}.default must be a ${param.type === "list" ? "list of strings" : param.type}`);
		} else {
			param.default = raw.default;
		}
	}
	if (param.required && raw.default !== undefined) errors.push(`${at}: a required parameter cannot have a default`);
	if (param.secret) {
		if (raw.default !== undefined) errors.push(`${at}: a secret parameter cannot have a default`);
		if (!param.env) errors.push(`${at}: a secret parameter needs "env", the variable it is read from`);
		if (param.type !== "string") errors.push(`${at}: a secret parameter must have type "string"`);
	} else if (param.env) {
		errors.push(`${at}: "env" is only for secret parameters`);
	}
	return param;
}

/** Validate a parsed manifest object. */
export function parseWorkflowManifest(raw: unknown): { manifest?: WorkflowManifest; errors: string[] } {
	const errors: string[] = [];
	if (!isRecord(raw)) return { errors: ["The manifest must be a JSON object"] };
	for (const key of Object.keys(raw)) {
		if (!MANIFEST_KEYS.includes(key)) errors.push(`Unknown manifest field "${key}"`);
	}
	if (typeof raw.description !== "string" || !raw.description.trim()) {
		errors.push('"description" must be a non-empty string');
	}
	const params: Record<string, WorkflowParam> = {};
	if (raw.params !== undefined) {
		if (!isRecord(raw.params)) {
			errors.push('"params" must be an object');
		} else {
			for (const [name, value] of Object.entries(raw.params)) {
				const param = parseParam(name, value, errors);
				if (param) params[name] = param;
			}
		}
	}
	let tools: string[] = [];
	if (!Array.isArray(raw.tools) || !raw.tools.every((tool) => typeof tool === "string" && tool.trim())) {
		errors.push('"tools" must be a list of tool names');
	} else {
		tools = [...new Set(raw.tools.map((tool: string) => tool.trim()))];
	}
	if (errors.length > 0) return { errors };
	return { manifest: { description: (raw.description as string).trim(), params, tools }, errors };
}

/**
 * Split a workflow file into its manifest and script. The manifest is the leading
 * `/* @workflow { ... } *\/` comment; the script keeps its line numbers.
 */
export function parseWorkflowText(text: string): {
	manifest?: WorkflowManifest;
	body?: string;
	errors: string[];
} {
	const leading = text.match(/^\s*/)?.[0] ?? "";
	const start = leading.length;
	const opener = `/* ${WORKFLOW_MANIFEST_TAG}`;
	if (!text.startsWith(opener, start)) {
		return { errors: [`The file must start with a \`${opener} { ... } */\` manifest comment`] };
	}
	const end = text.indexOf("*/", start);
	if (end === -1) return { errors: ["The manifest comment is not closed with */"] };
	const json = text.slice(start + opener.length, end);
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch (error) {
		return { errors: [`The manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
	}
	const { manifest, errors } = parseWorkflowManifest(raw);
	if (!manifest) return { errors };
	const body = text.slice(0, end + 2).replace(/[^\n]/g, "") + text.slice(end + 2);
	if (!body.trim()) return { errors: ["The workflow has no script after the manifest"] };
	return { manifest, body, errors: [] };
}

function loadWorkflowsFromDir(dir: string, source: WorkflowSource): WorkflowFile[] {
	let entries: string[];
	try {
		entries = readdirSync(dir).sort();
	} catch {
		return [];
	}
	const files: WorkflowFile[] = [];
	for (const entry of entries) {
		if (!entry.endsWith(WORKFLOW_FILE_SUFFIX)) continue;
		const name = entry.slice(0, -WORKFLOW_FILE_SUFFIX.length);
		const path = join(dir, entry);
		let text: string;
		try {
			text = readFileSync(path, "utf-8");
		} catch (error) {
			files.push({ name, path, source, text: "", errors: [error instanceof Error ? error.message : String(error)] });
			continue;
		}
		if (!isValidWorkflowName(name)) {
			files.push({ name, path, source, text, errors: ["Workflow names use letters, digits, `-`, `_`, and `.`"] });
			continue;
		}
		files.push({ name, path, source, text, ...parseWorkflowText(text) });
	}
	return files;
}

/**
 * User workflows, then project workflows when the project is trusted. Files that do not parse
 * are kept with their `errors`, so `/workflow check` can report them. A project workflow with
 * the name of a user workflow is skipped with a diagnostic.
 */
export function discoverWorkflows(options: {
	cwd: string;
	agentDir?: string;
	projectTrusted: boolean;
}): WorkflowDiscovery {
	const workflows = loadWorkflowsFromDir(getUserWorkflowsDir(options.agentDir), "user");
	const diagnostics: WorkflowDiagnostic[] = [];
	if (options.projectTrusted) {
		const names = new Set(workflows.map((workflow) => workflow.name));
		for (const workflow of loadWorkflowsFromDir(getProjectWorkflowsDir(options.cwd), "project")) {
			if (names.has(workflow.name)) {
				diagnostics.push({
					path: workflow.path,
					message: `Skipped: a project workflow cannot replace the user workflow "${workflow.name}"`,
				});
				continue;
			}
			workflows.push(workflow);
		}
	}
	return { workflows, diagnostics };
}
