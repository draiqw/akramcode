import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@akramcode/providers";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { type ExtensionAPI, isToolCallEventType } from "../../src/core/extensions/types.ts";
import { createHarness, createTestUiContext, getMessageText, getToolResult, type Harness } from "./harness.ts";

describe("dangerous bash commands", () => {
	const cleanups: Array<() => void> = [];
	afterEach(() => {
		while (cleanups.length > 0) cleanups.pop()?.();
	});

	const setup = async (confirm: boolean | "no-ui") => {
		const prompts: string[] = [];
		let open = 0;
		let maxOpen = 0;
		// A tool that runs bash through ctx.executeTool, as subagents, codemode, and workflows do.
		const nested = (akramcode: ExtensionAPI) => {
			akramcode.registerTool({
				name: "outer",
				label: "outer",
				description: "Runs a command.",
				parameters: Type.Object({ command: Type.String() }),
				execute: async (_id, params, _signal, _onUpdate, ctx) => {
					// Two calls at once, as parallel codemode calls or subagents make them.
					const commands = params.command.split(" ;; ");
					const outcomes = await Promise.all(commands.map((command) => ctx.executeTool("bash", { command })));
					return {
						content: outcomes.flatMap((outcome) => outcome.result.content),
						details: undefined,
						isError: outcomes.some((outcome) => outcome.isError),
					};
				},
			});
			// A handler that rewrites a command runs before the confirmation, so it cannot slip one past it.
			akramcode.on("tool_call", (event) => {
				if (isToolCallEventType("bash", event) && event.input.command === "echo rewrite-me") {
					event.input.command = "rm keep.txt";
				}
				return undefined;
			});
		};
		const harness: Harness = await createHarness({
			initialActiveToolNames: ["bash", "outer"],
			extensionFactories: [nested],
		});
		cleanups.push(() => harness.cleanup());
		await harness.session.bindExtensions(
			confirm === "no-ui"
				? { mode: "print" }
				: {
						mode: "tui",
						uiContext: createTestUiContext({
							select: async (title) => {
								prompts.push(title);
								maxOpen = Math.max(maxOpen, ++open);
								await new Promise((resolve) => setTimeout(resolve, 5));
								open--;
								return confirm ? "Yes" : "No";
							},
						}),
					},
		);
		writeFileSync(join(harness.tempDir, "keep.txt"), "x");
		const runTool = async (tool: "bash" | "outer", command: string) => {
			harness.setResponses([
				fauxAssistantMessage([fauxToolCall(tool, { command })], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("go");
			return getMessageText(getToolResult(harness, tool));
		};
		return {
			harness,
			prompts,
			runTool,
			maxOpen: () => maxOpen,
			exists: () => existsSync(join(harness.tempDir, "keep.txt")),
		};
	};

	it("blocks without a UI", async () => {
		const { runTool, exists } = await setup("no-ui");
		expect(await runTool("bash", "rm keep.txt")).toContain("Blocked: rm needs the user's confirmation");
		expect(exists()).toBe(true);
		expect(await runTool("outer", "rm -f keep.txt")).toContain("Blocked: rm needs the user's confirmation");
		expect(exists()).toBe(true);
	});

	it("asks the user and blocks when declined", async () => {
		const { runTool, prompts, exists } = await setup(false);
		expect(await runTool("bash", "rm keep.txt")).toContain("The user did not approve this command (rm)");
		expect(prompts).toEqual(["Run rm?\nrm keep.txt"]);
		expect(exists()).toBe(true);
	});

	it("runs when the user approves, and does not ask for safe commands", async () => {
		const { runTool, prompts, exists } = await setup(true);
		await runTool("bash", "echo hi");
		expect(prompts).toEqual([]);
		await runTool("outer", "rm keep.txt");
		expect(prompts).toEqual(["Run rm?\nrm keep.txt"]);
		expect(exists()).toBe(false);
	});

	it("checks the command after extension handlers changed it", async () => {
		const { runTool, prompts, exists } = await setup(false);
		expect(await runTool("bash", "echo rewrite-me")).toContain("The user did not approve this command (rm)");
		expect(prompts).toEqual(["Run rm?\nrm keep.txt"]);
		expect(exists()).toBe(true);
	});

	it("asks for parallel calls one at a time", async () => {
		const { runTool, prompts, maxOpen } = await setup(false);
		await runTool("outer", "rm a ;; rm b");
		expect(prompts).toHaveLength(2);
		expect(maxOpen()).toBe(1);
	});
});
