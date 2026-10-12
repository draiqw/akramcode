import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverWorkflows, parseWorkflowText } from "../src/extensions/workflows/format.ts";
import { parseRunArgs, tokenizeArgs } from "../src/extensions/workflows/index.ts";
import {
	buildWorkflowScript,
	coerceParamValue,
	createMasker,
	fillPrompt,
	parseJsonReply,
	resolveWorkflowParams,
} from "../src/extensions/workflows/run.ts";

function workflowText(manifest: unknown, script = "return 1;"): string {
	return `/* @workflow ${JSON.stringify(manifest, null, 2)} */\n${script}\n`;
}

describe("workflow manifest", () => {
	it("parses a manifest and keeps the script's line numbers", () => {
		const text = workflowText(
			{
				description: "Demo",
				params: {
					since: { type: "string", required: true, label: "Start tag" },
					count: { type: "number", default: 3 },
					token: { type: "string", secret: true, env: "DEMO_TOKEN" },
				},
				tools: ["bash", "read"],
			},
			"const x = params.since;",
		);
		const parsed = parseWorkflowText(text);
		expect(parsed.errors).toEqual([]);
		expect(parsed.manifest).toEqual({
			description: "Demo",
			params: {
				since: { type: "string", required: true, secret: false, label: "Start tag" },
				count: { type: "number", required: false, secret: false, default: 3 },
				token: { type: "string", required: false, secret: true, env: "DEMO_TOKEN" },
			},
			tools: ["bash", "read"],
		});
		const scriptLine = text.split("\n").findIndex((line) => line.includes("params.since"));
		expect(parsed.body?.split("\n")[scriptLine]).toBe("const x = params.since;");
		// The prelude takes the first line, so the script stays on its line.
		expect(buildWorkflowScript(parsed.body ?? "").split("\n")[scriptLine]).toBe("const x = params.since;");
	});

	it("rejects invalid manifests with specific errors", () => {
		expect(parseWorkflowText("return 1;").errors[0]).toContain("must start with");
		expect(parseWorkflowText("/* @workflow { nope */ return 1;").errors[0]).toContain("not valid JSON");
		const errors = parseWorkflowText(
			workflowText({
				description: "",
				params: {
					key: { type: "string", secret: true, default: "x" },
					both: { type: "number", required: true, default: 1 },
					odd: { type: "date" },
					"bad-name": { type: "string" },
				},
				tools: "bash",
				extra: true,
			}),
		).errors;
		expect(errors).toEqual(
			expect.arrayContaining([
				'Unknown manifest field "extra"',
				'"description" must be a non-empty string',
				"params.key: a secret parameter cannot have a default",
				'params.key: a secret parameter needs "env", the variable it is read from',
				"params.both: a required parameter cannot have a default",
				"params.odd.type must be one of string, number, boolean, list",
				"params.bad-name: parameter names must be JavaScript identifiers",
				'"tools" must be a list of tool names',
			]),
		);
	});
});

describe("workflow discovery", () => {
	const dirs: string[] = [];
	afterEach(() => {
		while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
	});

	function setup() {
		const root = mkdtempSync(join(tmpdir(), "akramcode-workflows-"));
		dirs.push(root);
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		mkdirSync(join(agentDir, "workflows"), { recursive: true });
		mkdirSync(join(cwd, ".akramcode", "workflows"), { recursive: true });
		const write = (dir: string, name: string, description: string) =>
			writeFileSync(join(dir, `${name}.workflow.js`), workflowText({ description, tools: [] }));
		write(join(agentDir, "workflows"), "shared", "user version");
		write(join(cwd, ".akramcode", "workflows"), "shared", "project version");
		write(join(cwd, ".akramcode", "workflows"), "local", "project only");
		writeFileSync(join(agentDir, "workflows", "broken.workflow.js"), "return 1;");
		writeFileSync(join(agentDir, "workflows", "notes.md"), "not a workflow");
		return { agentDir, cwd };
	}

	it("prefers user workflows and skips a project workflow with the same name", () => {
		const { agentDir, cwd } = setup();
		const { workflows, diagnostics } = discoverWorkflows({ cwd, agentDir, projectTrusted: true });
		expect(workflows.map((file) => [file.name, file.source, file.manifest?.description])).toEqual([
			["broken", "user", undefined],
			["shared", "user", "user version"],
			["local", "project", "project only"],
		]);
		expect(workflows[0].errors[0]).toContain("must start with");
		expect(diagnostics).toEqual([
			{
				path: join(cwd, ".akramcode", "workflows", "shared.workflow.js"),
				message: 'Skipped: a project workflow cannot replace the user workflow "shared"',
			},
		]);
	});

	it("ignores project workflows when the project is not trusted", () => {
		const { agentDir, cwd } = setup();
		const { workflows } = discoverWorkflows({ cwd, agentDir, projectTrusted: false });
		expect(workflows.map((file) => file.name)).toEqual(["broken", "shared"]);
	});
});

describe("workflow parameters", () => {
	const manifest = parseWorkflowText(
		workflowText({
			description: "Params",
			params: {
				since: { type: "string", required: true },
				count: { type: "number", default: 3 },
				verbose: { type: "boolean", default: false },
				tags: { type: "list" },
				token: { type: "string", secret: true, env: "WF_TOKEN", required: true },
			},
			tools: [],
		}),
	).manifest;
	if (!manifest) throw new Error("manifest did not parse");

	it("converts command strings, applies defaults, and reads secrets from the environment", async () => {
		const resolved = await resolveWorkflowParams(
			manifest,
			{ since: "v1", count: "7", verbose: "yes", tags: "a, b" },
			{ WF_TOKEN: "s3cret" },
		);
		expect(resolved.values).toEqual({ since: "v1", count: 7, verbose: true, tags: ["a", "b"], token: "s3cret" });
		expect([...resolved.secrets]).toEqual([["token", "s3cret"]]);
		const defaults = await resolveWorkflowParams(manifest, { since: "v1" }, { WF_TOKEN: "s3cret" });
		expect(defaults.values).toEqual({ since: "v1", count: 3, verbose: false, token: "s3cret" });
	});

	it("fails on missing, unknown, mistyped, and supplied secret values", async () => {
		await expect(resolveWorkflowParams(manifest, {}, { WF_TOKEN: "x" })).rejects.toThrow(
			"Missing required parameter since",
		);
		await expect(resolveWorkflowParams(manifest, { since: "v1" }, {})).rejects.toThrow("WF_TOKEN");
		await expect(resolveWorkflowParams(manifest, { since: "v1", nope: 1 }, { WF_TOKEN: "x" })).rejects.toThrow(
			"Unknown parameter nope",
		);
		await expect(resolveWorkflowParams(manifest, { since: "v1", token: "x" }, { WF_TOKEN: "x" })).rejects.toThrow(
			"read from $WF_TOKEN",
		);
		await expect(resolveWorkflowParams(manifest, { since: "v1" }, { WF_TOKEN: "x" })).rejects.toThrow(
			"shorter than 6 characters",
		);
		expect(() => coerceParamValue("count", { type: "number", required: false, secret: false }, "many")).toThrow(
			'Parameter count must be a number, got "many"',
		);
	});

	it("asks for a missing required value when it can", async () => {
		const resolved = await resolveWorkflowParams(manifest, {}, { WF_TOKEN: "secret-x" }, async (name) =>
			name === "since" ? "v2" : undefined,
		);
		expect(resolved.values.since).toBe("v2");
	});
});

describe("workflow helpers", () => {
	it("masks secret values", () => {
		const mask = createMasker(new Map([["token", "abc123"]]));
		expect(mask('{"auth":"abc123"} abc123')).toBe('{"auth":"***token***"} ***token***');
		const encoded = createMasker(new Map([["token", "a b/c+d"]]));
		expect(encoded(`q=${encodeURIComponent("a b/c+d")} ${Buffer.from("a b/c+d").toString("base64")}`)).toBe(
			"q=***token*** ***token***==",
		);
	});

	it("fills only known placeholders", () => {
		expect(fillPrompt('Sum {a} and {b}, keep {c} and {"x":1}', { a: "one", b: { n: 2 } })).toBe(
			'Sum one and {"n":2}, keep {c} and {"x":1}',
		);
	});

	it("parses JSON replies, also in a code fence, and checks the schema", () => {
		const schema = { type: "object", required: ["markdown"], properties: { markdown: { type: "string" } } };
		expect(parseJsonReply('```json\n{"markdown":"ok"}\n```', schema)).toEqual({ markdown: "ok" });
		expect(() => parseJsonReply("not json", schema)).toThrow("not valid JSON");
		expect(() => parseJsonReply('{"other":1}', schema)).toThrow("does not match the schema");
	});

	it("parses /workflow run arguments with quotes and --dry", () => {
		expect(tokenizeArgs(`run notes since=v1 "title=a b" --dry`)).toEqual([
			"run",
			"notes",
			"since=v1",
			"title=a b",
			"--dry",
		]);
		expect(parseRunArgs(["notes", "since=v1", "title=a b", "--dry"])).toEqual({
			name: "notes",
			params: { since: "v1", title: "a b" },
			dry: true,
		});
		expect(parseRunArgs(["notes", "oops"])).toEqual({ error: 'Expected param=value, got "oops"' });
	});
});
