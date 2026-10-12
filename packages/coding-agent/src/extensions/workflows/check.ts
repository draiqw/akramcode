/**
 * Static check of a workflow file (`/workflow check`), without running it: the manifest, the
 * script's syntax, the tools it calls, and parameters it never reads.
 *
 * The script is scanned for a narrow set of constructs (`tools.X`, `tools["X"]`, `params.X`,
 * `params["X"]`, `const { X } = params`) after comments are removed. Anything dynamic is left to
 * a `--dry` run.
 */

import { toCodemodeIdentifier } from "@akramcode/codemode/declarations";
import type { WorkflowFile } from "./format.ts";
import { buildWorkflowScript } from "./run.ts";

export type WorkflowCheckSeverity = "error" | "warning" | "unchecked";

export interface WorkflowCheckDiagnostic {
	code:
		| "MANIFEST_INVALID"
		| "SYNTAX_ERROR"
		| "TOOL_NOT_IN_MANIFEST"
		| "TOOL_UNKNOWN"
		| "TOOL_NOT_CALLABLE"
		| "TOOL_NOT_CHECKED"
		| "TOOL_UNUSED"
		| "PARAM_NOT_USED";
	severity: WorkflowCheckSeverity;
	message: string;
}

/** `ok`: no findings that block. `not checked`: no errors, but some tools could not be checked. */
export type WorkflowCheckStatus = "ok" | "failed" | "not checked";

export interface WorkflowCheckResult {
	status: WorkflowCheckStatus;
	diagnostics: WorkflowCheckDiagnostic[];
}

/** Remove `//` and `/* *\/` comments, keeping strings, template literals, regex literals, and line breaks. */
export function stripComments(code: string): string {
	let out = "";
	let i = 0;
	while (i < code.length) {
		const char = code[i];
		const next = code[i + 1];
		// A `/` where an expression starts begins a regex literal, which may contain `//`.
		if (char === "/" && next !== "/" && next !== "*" && /(^|[(,=:[!&|?{};+\-*%<>~^]|\breturn)\s*$/.test(out)) {
			let j = i + 1;
			let inClass = false;
			while (j < code.length && code[j] !== "\n" && (inClass || code[j] !== "/")) {
				if (code[j] === "\\") j++;
				else if (code[j] === "[") inClass = true;
				else if (code[j] === "]") inClass = false;
				j++;
			}
			out += code.slice(i, j + 1);
			i = j + 1;
			continue;
		}
		if (char === "/" && next === "/") {
			while (i < code.length && code[i] !== "\n") i++;
			continue;
		}
		if (char === "/" && next === "*") {
			const end = code.indexOf("*/", i + 2);
			const comment = end === -1 ? code.slice(i) : code.slice(i, end + 2);
			out += comment.replace(/[^\n]/g, "");
			i += comment.length;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			let j = i + 1;
			while (j < code.length && code[j] !== char) j += code[j] === "\\" ? 2 : 1;
			out += code.slice(i, j + 1);
			i = j + 1;
			continue;
		}
		out += char;
		i++;
	}
	return out;
}

/** Tool names the script calls as `tools.X` or `tools["X"]`. */
export function findToolReferences(code: string): string[] {
	const names = new Set<string>();
	for (const match of code.matchAll(/\btools\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*(["'`])([^"'`]+)\2\s*\])/g)) {
		names.add(match[1] ?? match[3]);
	}
	return [...names];
}

/**
 * Parameter names the script reads as `params.X`, `params?.X`, `params["X"]`, or `{ X } = params`.
 * `"*"` when `params` is used as a whole, as in `{ ...params }` or `Object.entries(params)`.
 */
export function findParamReferences(code: string): Set<string> {
	const names = new Set<string>();
	for (const match of code.matchAll(
		/\bparams\s*(?:\??\.\s*([A-Za-z_$][\w$]*)|(?:\?\.)?\[\s*(["'`])([^"'`]+)\2\s*\])/g,
	)) {
		names.add(match[1] ?? match[3]);
	}
	// Any other use, such as a spread, an argument, or a computed key, may read every parameter.
	for (const match of code.matchAll(
		/(?<![\w$])(?<!(?<!\.)\.)params\b(?!\s*(?:\??\.\s*[A-Za-z_$]|(?:\?\.)?\[\s*["'`]))/g,
	)) {
		if (!/\}\s*=\s*$/.test(code.slice(0, match.index))) names.add("*");
	}
	// One level of nested braces, for defaults such as `{ opts = {} } = params`.
	for (const match of code.matchAll(/\{((?:[^{}]|\{[^{}]*\})*)\}\s*=\s*params\b/g)) {
		for (const part of match[1].split(",")) {
			const name = part.split(":")[0].split("=")[0].trim();
			if (name) names.add(name);
		}
	}
	return names;
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => unknown;

/** The syntax error of the workflow script as the runner builds it, or undefined. Compiles without running. */
export function findSyntaxError(body: string): string | undefined {
	try {
		new AsyncFunction("tools", "console", buildWorkflowScript(body));
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

/**
 * Check `file` against the session's tools: `callableTools` are the tools scripts can call,
 * `registeredTools` every registered tool. A missing `mcp__` tool is "not checked" rather than
 * unknown: its server may not be connected.
 */
export function checkWorkflow(
	file: WorkflowFile,
	callableTools: readonly string[],
	registeredTools: readonly string[] = callableTools,
): WorkflowCheckResult {
	const diagnostics: WorkflowCheckDiagnostic[] = [];
	if (!file.manifest || file.body === undefined) {
		for (const message of file.errors) diagnostics.push({ code: "MANIFEST_INVALID", severity: "error", message });
		return { status: "failed", diagnostics };
	}
	const { manifest, body } = file;

	const syntaxError = findSyntaxError(body);
	if (syntaxError) diagnostics.push({ code: "SYNTAX_ERROR", severity: "error", message: syntaxError });

	const code = stripComments(body);
	const allowed = new Map(manifest.tools.map((name) => [toCodemodeIdentifier(name), name]));
	const used = new Set<string>();
	for (const reference of findToolReferences(code)) {
		const name = manifest.tools.includes(reference) ? reference : allowed.get(reference);
		if (!name) {
			diagnostics.push({
				code: "TOOL_NOT_IN_MANIFEST",
				severity: "error",
				message: `tools.${reference} is called but not listed in "tools"`,
			});
			continue;
		}
		used.add(name);
	}
	const callable = new Set(callableTools);
	const registered = new Set(registeredTools);
	for (const name of manifest.tools) {
		if (registered.has(name) && !callable.has(name)) {
			diagnostics.push({
				code: "TOOL_NOT_CALLABLE",
				severity: "error",
				message: `${name} is not active in this session; enable it with --tools or the defaultTools setting`,
			});
		} else if (!callable.has(name)) {
			diagnostics.push(
				name.startsWith("mcp__")
					? {
							code: "TOOL_NOT_CHECKED",
							severity: "unchecked",
							message: `${name}: not checked, its MCP server is not connected or does not have it`,
						}
					: { code: "TOOL_UNKNOWN", severity: "error", message: `${name} is not a tool of this session` },
			);
		} else if (!used.has(name)) {
			diagnostics.push({
				code: "TOOL_UNUSED",
				severity: "warning",
				message: `${name} is listed in "tools" but never called`,
			});
		}
	}

	const read = findParamReferences(code);
	for (const name of Object.keys(manifest.params)) {
		if (!read.has(name) && !read.has("*")) {
			diagnostics.push({
				code: "PARAM_NOT_USED",
				severity: "error",
				message: `params.${name} is never read, so the parameter has no effect`,
			});
		}
	}

	const status: WorkflowCheckStatus = diagnostics.some((diagnostic) => diagnostic.severity === "error")
		? "failed"
		: diagnostics.some((diagnostic) => diagnostic.severity === "unchecked")
			? "not checked"
			: "ok";
	return { status, diagnostics };
}

/** One line per finding, after a status line. */
export function formatCheckResult(name: string, result: WorkflowCheckResult): string {
	const lines = [`workflow ${name}: ${result.status}`];
	for (const diagnostic of result.diagnostics) {
		lines.push(`  ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
	}
	return lines.join("\n");
}
