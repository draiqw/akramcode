import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@akramcode/providers";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, ExtensionUIContext, ToolCallEvent } from "../../src/core/extensions/types.ts";
import type { CustomMessageEntry } from "../../src/core/session-manager.ts";
import { createWorkflowsExtension } from "../../src/extensions/workflows/index.ts";
import { WORKFLOW_RUN_CUSTOM_TYPE, type WorkflowRunDetails } from "../../src/extensions/workflows/run.ts";
import { createHarness, createTestUiContext, getToolResult, type Harness } from "./harness.ts";

const SECRET = "tok-9f8e7d";

const DEMO = `/* @workflow {
  "description": "Write a greeting and read it back",
  "params": {
    "name": { "type": "string", "required": true },
    "token": { "type": "string", "secret": true, "env": "WF_TEST_TOKEN" }
  },
  "tools": ["write", "read"]
} */
await step("write", () => tools.write({ path: "out.txt", content: \`hello \${params.name} \${params.token}\` }));
const text = await step("read", () => tools.read({ path: "out.txt" }));
check(text.includes(params.name), "name missing");
const summary = await step("summarize", () =>
  llm({ prompt: "Summarize {text}", input: { text }, schema: { type: "object", required: ["summary"] } }));
return \`\${summary.summary} \${params.token}\`;
`;

const CHECK_STOPS = `/* @workflow { "description": "Stops at a check", "tools": ["read"] } */
await step("first", async () => 1);
check(false, "stop here");
await step("never", async () => 2);
`;

const TOOL_ERROR = `/* @workflow { "description": "Reads a missing file", "tools": ["read"] } */
await step("ok", async () => "fine");
await step("missing", () => tools.read({ path: "does-not-exist.txt" }));
await step("never", async () => 2);
`;

const NOT_ALLOWED = `/* @workflow { "description": "Calls a tool it did not list", "tools": ["read"] } */
await step("sneaky", () => tools.bash({ command: "echo hi" }));
`;

const ASK = `/* @workflow { "description": "Asks the user", "tools": [] } */
const answer = await ask({ question: "Ship it?", options: ["yes", "no"] });
return answer;
`;

const DRY = `/* @workflow { "description": "Writes and reads", "tools": ["write", "read", "bash"] } */
const written = await step("write", () => tools.write({ path: "dry.txt", content: "x" }));
const shell = await step("shell", () => tools.bash({ command: "touch shell.txt" }));
const read = await step("read", () => tools.read({ path: "input.txt" }));
return { written, shell, read };
`;

interface Setup {
	harness: Harness;
	toolCalls: ToolCallEvent[];
	run(command: string): Promise<WorkflowRunDetails & { content: string }>;
}

describe("workflows", () => {
	const cleanups: (() => void)[] = [];

	afterEach(() => {
		while (cleanups.length > 0) cleanups.pop()?.();
		delete process.env.WF_TEST_TOKEN;
	});

	async function setup(ui: Partial<ExtensionUIContext> | false = {}): Promise<Setup> {
		const agentDir = mkdtempSync(join(tmpdir(), "akramcode-workflows-agent-"));
		cleanups.push(() => rmSync(agentDir, { recursive: true, force: true }));
		mkdirSync(join(agentDir, "workflows"));
		for (const [name, text] of Object.entries({
			demo: DEMO,
			"check-stops": CHECK_STOPS,
			"tool-error": TOOL_ERROR,
			"not-allowed": NOT_ALLOWED,
			ask: ASK,
			dry: DRY,
		})) {
			writeFileSync(join(agentDir, "workflows", `${name}.workflow.js`), text);
		}
		const toolCalls: ToolCallEvent[] = [];
		const hooks = (akramcode: ExtensionAPI) => {
			akramcode.on("tool_call", (event) => {
				toolCalls.push(event);
			});
		};
		const harness = await createHarness({
			initialActiveToolNames: ["read", "write", "bash"],
			extensionFactories: [createWorkflowsExtension({ agentDir }), hooks],
		});
		cleanups.push(() => harness.cleanup());
		await harness.session.bindExtensions(
			ui === false ? { mode: "print" } : { uiContext: createTestUiContext(ui), mode: "tui" },
		);
		const run = async (command: string) => {
			await harness.session.prompt(command);
			const entry = harness.sessionManager
				.getEntries()
				.findLast(
					(candidate): candidate is CustomMessageEntry =>
						candidate.type === "custom_message" && candidate.customType === WORKFLOW_RUN_CUSTOM_TYPE,
				);
			if (!entry) throw new Error(`No workflow run recorded for ${command}`);
			const content = typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content);
			return { ...(entry.details as unknown as WorkflowRunDetails), content };
		};
		return { harness, toolCalls, run };
	}

	it("runs steps in order with parameters, through the tool hooks, and records no secrets", async () => {
		process.env.WF_TEST_TOKEN = SECRET;
		const { harness, toolCalls, run } = await setup();
		harness.setResponses([fauxAssistantMessage('{"summary":"greeted"}')]);

		const details = await run("/workflow run demo name=Ada");

		expect(details.status).toBe("completed");
		expect(details.steps.map((step) => [step.id, step.status])).toEqual([
			["write", "ok"],
			["read", "ok"],
			["summarize", "ok"],
		]);
		expect(details.params).toEqual({ name: "Ada", token: "***token***" });
		expect(details.output).toBe("greeted ***token***");
		// The tool got the real value; the record and the model-facing text did not.
		expect(readFileSync(join(harness.tempDir, "out.txt"), "utf-8")).toBe(`hello Ada ${SECRET}`);
		const entries = JSON.stringify(harness.sessionManager.getEntries());
		expect(entries).not.toContain(SECRET);
		expect(details.content).toContain("workflow demo completed · 3 steps");
		// Nested calls went through tool_call handlers, with the run as their parent.
		expect(toolCalls.map((event) => event.toolName)).toEqual(["write", "read"]);
		expect(toolCalls.every((event) => event.parentToolCallId?.startsWith("workflow:demo:"))).toBe(true);
		expect(details.calls.map((call) => call.id)).toEqual([
			`${toolCalls[0].parentToolCallId}/1`,
			`${toolCalls[0].parentToolCallId}/2`,
		]);
	});

	it("stops at a failed check", async () => {
		const { run } = await setup();
		const details = await run("/workflow run check-stops");
		expect(details.status).toBe("failed");
		expect(details.error).toContain("check failed: stop here");
		expect(details.steps.map((step) => [step.id, step.status])).toEqual([["first", "ok"]]);
	});

	it("fails the step whose tool result is an error", async () => {
		const { run } = await setup();
		const details = await run("/workflow run tool-error");
		expect(details.status).toBe("failed");
		expect(details.steps.map((step) => [step.id, step.status])).toEqual([
			["ok", "ok"],
			["missing", "error"],
		]);
		expect(details.content).toContain("workflow tool-error failed · missing:");
	});

	it("rejects tools that the manifest does not list", async () => {
		const { toolCalls, run } = await setup();
		const details = await run("/workflow run not-allowed");
		expect(details.status).toBe("failed");
		expect(details.steps[0].error).toContain('tools.bash is not in the workflow\'s "tools" list');
		expect(toolCalls).toEqual([]);
	});

	it("asks through the question dialog, and needs input without a UI", async () => {
		const withUi = await setup({
			custom: async <T>() => ({ answers: [{ selected: ["yes"], attachments: [] }] }) as T,
		});
		expect((await withUi.run("/workflow run ask")).output).toBe("yes");

		const headless = await setup(false);
		const details = await headless.run("/workflow run ask");
		expect(details.status).toBe("needs_input");
		expect(details.error).toBe("needs input: Ship it?");
	});

	it("dry run stubs tools without readOnlyHint and calls read-only tools", async () => {
		const { harness, toolCalls, run } = await setup();
		writeFileSync(join(harness.tempDir, "input.txt"), "input text");

		const details = await run("/workflow run dry --dry");

		expect(details.status).toBe("completed");
		expect(details.dry).toBe(true);
		expect(existsSync(join(harness.tempDir, "dry.txt"))).toBe(false);
		expect(existsSync(join(harness.tempDir, "shell.txt"))).toBe(false);
		expect(toolCalls.map((event) => event.toolName)).toEqual(["read"]);
		expect(details.calls.map((call) => [call.name, call.stubbed === true])).toEqual([
			["write", true],
			["bash", true],
			["read", false],
		]);
		const output = JSON.parse(details.output ?? "{}");
		expect(output.written).toEqual({ dry_run: true, tool: "write", arguments: { path: "dry.txt", content: "x" } });
		expect(output.shell).toEqual({ dry_run: true, tool: "bash", arguments: { command: "touch shell.txt" } });
		expect(output.read).toContain("input text");
	});

	it("lets the agent run a workflow with workflow_run after confirmation", async () => {
		process.env.WF_TEST_TOKEN = SECRET;
		const confirms: string[] = [];
		const { harness, toolCalls } = await setup({
			confirm: async (title) => {
				confirms.push(title);
				return true;
			},
		});
		const tool = harness.session.agent.state.tools.find((candidate) => candidate.name === "workflow_run");
		expect(tool?.description).toContain("- demo: Write a greeting and read it back Params: name (string, required)");
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("workflow_run", { name: "demo", params: { name: "Lin" } })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage('{"summary":"ok"}'),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("run the demo workflow");

		expect(confirms).toEqual(["Run workflow demo?"]);
		const result = getToolResult(harness, "workflow_run");
		expect(result.isError).toBe(false);
		expect((result.details as unknown as WorkflowRunDetails).status).toBe("completed");
		expect(
			toolCalls.filter((event) => event.parentToolCallId === result.toolCallId).map((event) => event.toolName),
		).toEqual(["write", "read"]);
		// The nested call record on the result message keeps the arguments, with the secret masked.
		expect(result.nestedCalls?.calls.map((call) => call.name)).toEqual(["write", "read"]);
		expect(JSON.stringify(result.nestedCalls)).toContain("***token***");
		expect(JSON.stringify(harness.sessionManager.getEntries())).not.toContain(SECRET);
	});

	it("does not run a writing workflow the user declines, and dry runs need no confirmation", async () => {
		let confirmations = 0;
		const { harness } = await setup({
			confirm: async () => {
				confirmations++;
				return false;
			},
		});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("workflow_run", { name: "check-stops" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("workflow_run", { name: "dry", dry: true })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		writeFileSync(join(harness.tempDir, "input.txt"), "input text");

		await harness.session.prompt("go");

		const results = harness.session.messages.filter(
			(message) => message.role === "toolResult" && message.toolName === "workflow_run",
		);
		// check-stops only lists read, which is read-only: no confirmation, it runs and fails at its check.
		expect(confirmations).toBe(0);
		expect(results.map((message) => (message.role === "toolResult" ? message.isError : undefined))).toEqual([
			true,
			false,
		]);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("workflow_run", { name: "demo", params: { name: "x" } })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("again");
		expect(confirmations).toBe(1);
		const declined = getToolResult(harness, "workflow_run");
		expect(declined.isError).toBe(true);
		expect(JSON.stringify(declined.content)).toContain('The user did not approve running workflow \\"demo\\"');
		expect(existsSync(join(harness.tempDir, "out.txt"))).toBe(false);
	});

	it("runs workflow_run without asking when there is no UI", async () => {
		process.env.WF_TEST_TOKEN = SECRET;
		const { harness } = await setup(false);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("workflow_run", { name: "demo", params: { name: "Bo" } })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage('{"summary":"fine"}'),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("go");
		expect((getToolResult(harness, "workflow_run").details as unknown as WorkflowRunDetails).status).toBe(
			"completed",
		);
		expect(readFileSync(join(harness.tempDir, "out.txt"), "utf-8")).toBe(`hello Bo ${SECRET}`);
	});
});
