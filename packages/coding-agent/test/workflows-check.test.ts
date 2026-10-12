import { describe, expect, it } from "vitest";
import { checkWorkflow, stripComments } from "../src/extensions/workflows/check.ts";
import { parseWorkflowText, type WorkflowFile } from "../src/extensions/workflows/format.ts";

function file(manifest: unknown, script: string): WorkflowFile {
	const text = `/* @workflow ${JSON.stringify(manifest)} */\n${script}\n`;
	return { name: "demo", path: "/tmp/demo.workflow.js", source: "user", text, ...parseWorkflowText(text) };
}

const codes = (result: ReturnType<typeof checkWorkflow>) => result.diagnostics.map((diagnostic) => diagnostic.code);

describe("workflow check", () => {
	it("passes a workflow whose tools and parameters are all used", () => {
		const result = checkWorkflow(
			file(
				{
					description: "ok",
					params: { path: { type: "string", required: true } },
					tools: ["read", "mcp__docs-api__search"],
				},
				'const text = await step("read", () => tools.read({ path: params.path }));\nawait tools.mcp__docs_api__search({ q: text });',
			),
			["read", "mcp__docs-api__search"],
		);
		expect(result).toEqual({ status: "ok", diagnostics: [] });
	});

	it("reports invalid manifests", () => {
		const result = checkWorkflow(file({ description: "x" }, "return 1;"), []);
		expect(result.status).toBe("failed");
		expect(result.diagnostics).toEqual([
			{ code: "MANIFEST_INVALID", severity: "error", message: '"tools" must be a list of tool names' },
		]);
	});

	it("reports syntax errors", () => {
		const result = checkWorkflow(file({ description: "x", tools: [] }, "const = 1;"), []);
		expect(result.status).toBe("failed");
		expect(codes(result)).toEqual(["SYNTAX_ERROR"]);
	});

	it("reports tools outside the manifest, unknown, inactive, and unused tools", () => {
		const result = checkWorkflow(
			file(
				{ description: "x", tools: ["read", "grep", "nope", "write"] },
				'await tools.read({ path: "a" });\nawait tools["bash"]({ command: "ls" });\nawait tools.grep({ pattern: "x" });',
			),
			["read", "bash", "write"],
			["read", "bash", "write", "grep"],
		);
		expect(result.status).toBe("failed");
		expect(result.diagnostics).toEqual([
			{ code: "TOOL_NOT_IN_MANIFEST", severity: "error", message: 'tools.bash is called but not listed in "tools"' },
			{
				code: "TOOL_NOT_CALLABLE",
				severity: "error",
				message: "grep is not active in this session; enable it with --tools or the defaultTools setting",
			},
			{ code: "TOOL_UNKNOWN", severity: "error", message: "nope is not a tool of this session" },
			{ code: "TOOL_UNUSED", severity: "warning", message: 'write is listed in "tools" but never called' },
		]);
	});

	it("does not report a tool of an MCP server that is not connected as ok", () => {
		const result = checkWorkflow(
			file(
				{ description: "x", tools: ["mcp__github__create_release"] },
				"await tools.mcp__github__create_release({});",
			),
			[],
		);
		expect(result.status).toBe("not checked");
		expect(codes(result)).toEqual(["TOOL_NOT_CHECKED"]);
	});

	it("reports parameters the script never reads", () => {
		const result = checkWorkflow(
			file(
				{
					description: "x",
					params: {
						a: { type: "string" },
						b: { type: "string" },
						c: { type: "string" },
						unused: { type: "string" },
					},
					tools: [],
				},
				`// params.unused only appears in a comment\nconst { a } = params;\nconst text = \`\${params["b"]} \${params.c}\`;\nreturn a + text;`,
			),
			[],
		);
		expect(result.diagnostics).toEqual([
			{
				code: "PARAM_NOT_USED",
				severity: "error",
				message: "params.unused is never read, so the parameter has no effect",
			},
		]);
	});

	it("strips comments but keeps strings and line breaks", () => {
		expect(stripComments('a // x\nb /* y\nz */ c "// not a comment"')).toBe('a \nb \n c "// not a comment"');
	});

	it("counts optional chaining and whole-object uses as reads, and keeps regex literals", () => {
		const manifest = {
			description: "x",
			params: { a: { type: "string" }, b: { type: "string" } },
			tools: ["read"],
		};
		expect(
			codes(
				checkWorkflow(file(manifest, 'const x = params?.a + params?.["b"];\nawait tools.read({ path: x });'), [
					"read",
				]),
			),
		).toEqual([]);
		expect(
			codes(
				checkWorkflow(file(manifest, "const all = { ...params };\nawait tools.read({ path: all.a });"), ["read"]),
			),
		).toEqual([]);
		expect(
			codes(
				checkWorkflow(
					file(
						manifest,
						'const ok = /https?:\\/\\//.test(params.a + params.b) && (await tools.read({ path: "x" }));',
					),
					["read"],
				),
			),
		).toEqual([]);
	});
});
