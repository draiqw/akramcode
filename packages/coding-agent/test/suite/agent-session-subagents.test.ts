import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCurrentSystemPrompt, getCurrentTools, type TranscriptContext } from "@akramcode/ai";
import { fauxAssistantMessage, fauxToolCall } from "@akramcode/providers";
import type { AssistantMessage, FauxResponseFactory, ToolResultMessage } from "@akramcode/providers/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../../src/core/extensions/types.ts";
import type { CustomMessage } from "../../src/core/messages.ts";
import { createAgentSession } from "../../src/core/sdk.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import { DEFAULT_TOOL_NAMES } from "../../src/core/settings-manager.ts";
import type { AgentToolDetails } from "../../src/core/subagents/agent-tool.ts";
import { TASK_NOTIFICATION_CUSTOM_TYPE, type TaskNotificationDetails } from "../../src/core/tasks/notifications.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const SUBAGENT_MARKER = "You are a subagent";

interface ChildRequest {
	tools: string[];
	systemPrompt: string;
	prompt: string;
	/** Whether the request carries tool results, so the child already ran a tool. */
	hasToolResults: boolean;
}

function lastUserText(context: TranscriptContext): string {
	const user = context.messages.findLast((message) => message.role === "user");
	return user ? getMessageText(user) : "";
}

/**
 * Route faux requests: subagent requests (recognized by their system prompt) go to `child`, the
 * parent's requests take the next of `parentSteps`.
 */
function route(
	harness: Harness,
	parentSteps: AssistantMessage[],
	child: (request: ChildRequest, signal: AbortSignal | undefined) => AssistantMessage | Promise<AssistantMessage>,
): ChildRequest[] {
	const childRequests: ChildRequest[] = [];
	let parentIndex = 0;
	const respond: FauxResponseFactory = (context, options) => {
		const systemPrompt = getCurrentSystemPrompt(context.messages);
		if (systemPrompt.includes(SUBAGENT_MARKER)) {
			const request = {
				tools: getCurrentTools(context.messages).map((tool) => tool.name),
				systemPrompt,
				prompt: lastUserText(context),
				hasToolResults: context.messages.some((message) => message.role === "toolResult"),
			};
			childRequests.push(request);
			return child(request, options?.signal);
		}
		const step = parentSteps[parentIndex++];
		if (!step) throw new Error(`No parent response ${parentIndex}`);
		return step;
	};
	harness.setResponses(Array.from({ length: 30 }, () => respond));
	return childRequests;
}

function toolResults(harness: Harness, toolName: string): ToolResultMessage[] {
	return harness.session.messages.filter(
		(message): message is ToolResultMessage => message.role === "toolResult" && message.toolName === toolName,
	);
}

function notifications(harness: Harness): CustomMessage<TaskNotificationDetails>[] {
	return harness.session.messages.filter(
		(message): message is CustomMessage<TaskNotificationDetails> =>
			message.role === "custom" && message.customType === TASK_NOTIFICATION_CUSTOM_TYPE,
	);
}

function schemaProperties(schema: unknown): Record<string, unknown> {
	return (schema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
}

function lastAssistantText(harness: Harness): string {
	const last = harness.session.messages.findLast((message) => message.role === "assistant");
	return last ? getMessageText(last) : "";
}

describe("AgentSession subagents and background tasks", () => {
	const harnesses: Harness[] = [];
	const cleanupPaths: string[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
		for (const path of cleanupPaths.splice(0)) rmSync(path, { recursive: true, force: true });
	});

	async function setup(settings?: Partial<Settings>, extensionFactories?: Array<(akramcode: ExtensionAPI) => void>) {
		const harness = await createHarness({
			settings,
			createSubagentSession: createAgentSession,
			extensionFactories,
			initialActiveToolNames: [...DEFAULT_TOOL_NAMES],
		});
		harnesses.push(harness);
		return harness;
	}

	it("activates agent, task_stop, and monitor by default and honors the settings", async () => {
		const harness = await setup();
		expect(harness.session.getActiveToolNames()).toEqual(expect.arrayContaining(["agent", "task_stop", "monitor"]));
		const agentTool = harness.session.getToolDefinition("agent");
		expect(Object.keys(schemaProperties(agentTool?.parameters))).toContain("run_in_background");
		expect(agentTool?.description).toContain("- general-purpose:");
		expect(agentTool?.description).toContain("- explore:");

		const noSubagents = await setup({ subagents: { enabled: false } });
		expect(noSubagents.session.getActiveToolNames()).not.toContain("agent");
		expect(noSubagents.session.getActiveToolNames()).toContain("monitor");

		const noBackground = await setup({ backgroundTasks: { enabled: false } });
		expect(noBackground.session.getActiveToolNames()).toContain("agent");
		expect(noBackground.session.getActiveToolNames()).not.toContain("task_stop");
		expect(noBackground.session.getActiveToolNames()).not.toContain("monitor");
		expect(Object.keys(schemaProperties(noBackground.session.getToolDefinition("agent")?.parameters))).not.toContain(
			"run_in_background",
		);
	});

	it("runs a foreground subagent with a fresh context and returns its final text", async () => {
		const harness = await setup();
		const childRequests = route(
			harness,
			[
				fauxAssistantMessage(
					fauxToolCall("agent", {
						description: "List files",
						prompt: "List the files in the working directory.",
						subagent_type: "explore",
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("Parent done."),
			],
			(request) =>
				request.hasToolResults
					? fauxAssistantMessage("Child report: no files.")
					: fauxAssistantMessage(fauxToolCall("ls", { path: "." }), { stopReason: "toolUse" }),
		);
		const originalPrompt = "List the files in the working directory.";

		await harness.session.prompt("Use an agent.");

		expect(childRequests.length).toBe(2);
		expect(childRequests[0].prompt).toBe(originalPrompt);
		// Fresh context: the child never sees the parent's user message.
		expect(childRequests[0].systemPrompt).toContain("You are a read-only explorer");
		expect(childRequests[0].tools.sort()).toEqual(["bash", "find", "grep", "ls", "read"]);

		const [result] = toolResults(harness, "agent");
		expect(result.isError).toBe(false);
		const details = result.details as unknown as AgentToolDetails;
		expect(details).toMatchObject({ agentType: "explore", status: "completed", toolUses: 1, activity: ["ls ."] });
		expect(details.usage.turns).toBe(2);
		expect(lastAssistantText(harness)).toBe("Parent done.");
		expect(details.transcriptFile).toBeDefined();
		if (details.transcriptFile) {
			cleanupPaths.push(details.transcriptFile);
			expect(readFileSync(details.transcriptFile, "utf-8")).toContain(originalPrompt);
		}
	});

	it("does not give subagents the agent tool or background tasks", async () => {
		const harness = await setup();
		const childRequests = route(
			harness,
			[
				fauxAssistantMessage(fauxToolCall("agent", { description: "Do work", prompt: "Work." }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("ok"),
			],
			() => fauxAssistantMessage("worked"),
		);

		await harness.session.prompt("go");

		expect(childRequests).toHaveLength(1);
		expect(childRequests[0].tools.sort()).toEqual(["bash", "edit", "find", "grep", "ls", "read", "write"]);
		expect(childRequests[0].tools).not.toContain("agent");
		expect(childRequests[0].tools).not.toContain("monitor");
		const transcript = (toolResults(harness, "agent")[0].details as unknown as AgentToolDetails).transcriptFile;
		if (transcript) cleanupPaths.push(transcript);
	});

	it("runs parallel agent calls concurrently", async () => {
		const harness = await setup();
		let active = 0;
		let maxActive = 0;
		route(
			harness,
			[
				fauxAssistantMessage(
					[
						fauxToolCall("agent", { description: "First", prompt: "task one" }),
						fauxToolCall("agent", { description: "Second", prompt: "task two" }),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("combined"),
			],
			async (request) => {
				active++;
				maxActive = Math.max(maxActive, active);
				await new Promise((resolve) => setTimeout(resolve, 50));
				active--;
				return fauxAssistantMessage(`answer for ${request.prompt}`);
			},
		);

		await harness.session.prompt("parallel");

		expect(maxActive).toBe(2);
		const texts = toolResults(harness, "agent").map((result) => getMessageText(result));
		expect(texts.sort()).toEqual(["answer for task one", "answer for task two"]);
		for (const result of toolResults(harness, "agent")) {
			const transcript = (result.details as unknown as AgentToolDetails).transcriptFile;
			if (transcript) cleanupPaths.push(transcript);
		}
	});

	it("aborts the subagent when the parent tool call is aborted", async () => {
		const harness = await setup();
		let childAborted = false;
		let resolveChildStarted: () => void = () => {};
		const childStarted = new Promise<void>((resolve) => {
			resolveChildStarted = resolve;
		});
		route(
			harness,
			[
				fauxAssistantMessage(fauxToolCall("agent", { description: "Slow", prompt: "slow" }), {
					stopReason: "toolUse",
				}),
			],
			(_request, signal) =>
				new Promise<AssistantMessage>((resolve) => {
					resolveChildStarted();
					signal?.addEventListener("abort", () => {
						childAborted = true;
						resolve(fauxAssistantMessage("late", { stopReason: "aborted" }));
					});
				}),
		);

		const run = harness.session.prompt("go");
		await childStarted;
		await harness.session.abort();
		await run;

		expect(childAborted).toBe(true);
		const [result] = toolResults(harness, "agent");
		expect(result.isError).toBe(true);
		expect(getMessageText(result)).toContain("aborted");
	});

	it("rejects unknown agent types", async () => {
		const harness = await setup();
		route(
			harness,
			[
				fauxAssistantMessage(fauxToolCall("agent", { description: "x", prompt: "y", subagent_type: "nope" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("ok"),
			],
			() => fauxAssistantMessage("unused"),
		);
		await harness.session.prompt("go");
		const [result] = toolResults(harness, "agent");
		expect(result.isError).toBe(true);
		expect(getMessageText(result)).toContain('Unknown agent type "nope". Available: general-purpose, explore');
	});

	it("gives custom agent types exactly their allowed tools, including extension and MCP tools", async () => {
		const executed: string[] = [];
		const registerTools = (akramcode: ExtensionAPI) => {
			for (const [name, exposure] of [
				["web_fetch", "direct"],
				["mcp__gh__issues", "codemode"],
				["mcp__gh__pulls", "deferred"],
				["mcp__slack__post", "codemode"],
			] as const) {
				akramcode.registerTool({
					name,
					label: name,
					description: `${name} tool`,
					parameters: Type.Object({}),
					exposure,
					execute: async () => {
						executed.push(name);
						return { content: [{ type: "text", text: `${name} ran` }], details: {} };
					},
				});
			}
		};
		const harness = await setup(undefined, [registerTools]);
		await harness.session.bindExtensions({});
		const agentsDir = join(harness.tempDir, "agent", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "triager.md"),
			"---\nname: triager\ndescription: Triages issues\ntools: read, mcp__gh__*, web_fetch, nope\ndisallowedTools: mcp__gh__pulls\nthinking: off\n---\nTriage issues.\n",
		);
		// The definition was written after the session started: reload it as `/agents` does.
		const control = harness.session.subagents;
		expect(control).toBeDefined();
		control?.reload();
		const triager = control?.listTypes().types.find((type) => type.name === "triager");
		expect(triager && control?.resolveTools(triager)).toEqual({
			tools: ["read", "mcp__gh__issues", "web_fetch"],
			unknown: ["nope"],
		});
		expect(harness.session.agent.state.tools.find((tool) => tool.name === "agent")?.description).toContain(
			"- triager: Triages issues (Tools: read, mcp__gh__issues, web_fetch)",
		);

		const childRequests = route(
			harness,
			[
				fauxAssistantMessage(
					fauxToolCall("agent", { description: "Triage", prompt: "triage", subagent_type: "triager" }),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("done"),
			],
			(request) =>
				request.hasToolResults
					? fauxAssistantMessage("triaged")
					: fauxAssistantMessage(fauxToolCall("mcp__gh__issues", {}), { stopReason: "toolUse" }),
		);
		await harness.session.prompt("go");

		expect(childRequests[0].tools.sort()).toEqual(["mcp__gh__issues", "read", "web_fetch"]);
		expect(childRequests[0].systemPrompt).toContain("Triage issues.");
		// The shared MCP tool definition really runs in the child.
		expect(executed).toEqual(["mcp__gh__issues"]);
		const details = toolResults(harness, "agent")[0].details as unknown as AgentToolDetails;
		expect(details.activity).toEqual(["mcp__gh__issues {}"]);
		if (details.transcriptFile) cleanupPaths.push(details.transcriptFile);
	});

	it("runs a background agent and notifies the session with its result", async () => {
		const harness = await setup();
		route(
			harness,
			[
				fauxAssistantMessage(
					fauxToolCall("agent", { description: "Research", prompt: "research it", run_in_background: true }),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("Started research."),
				fauxAssistantMessage("Research finished: background findings."),
			],
			async () => {
				await new Promise((resolve) => setTimeout(resolve, 30));
				return fauxAssistantMessage("background findings");
			},
		);

		await harness.session.prompt("start");
		const [result] = toolResults(harness, "agent");
		expect(getMessageText(result)).toContain("Agent running in background with ID: a1");

		expect(await harness.session.waitForBackgroundTasks(10_000)).toBe(true);

		const [notification] = notifications(harness);
		expect(notification.details?.task).toMatchObject({ id: "a1", kind: "agent", status: "completed" });
		expect(notification.content).toContain("<result>\nbackground findings\n</result>");
		expect(lastAssistantText(harness)).toBe("Research finished: background findings.");
		const task = harness.session.tasks.get("a1");
		expect(task?.usage?.turns).toBe(1);
		if (task) {
			expect(readFileSync(task.outputFile, "utf-8")).toContain("Result:\nbackground findings");
			cleanupPaths.push(task.outputFile);
			if (task.transcriptFile) cleanupPaths.push(task.transcriptFile);
		}
	});

	it("delivers monitor output and completion as notifications that trigger turns", async () => {
		const harness = await setup();
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("monitor", { command: "sleep 0.2; echo server-ready", description: "wait for server" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("Watching."),
			fauxAssistantMessage("Saw the line."),
			fauxAssistantMessage("Monitor ended."),
		]);

		await harness.session.prompt("watch");
		expect(await harness.session.waitForBackgroundTasks(10_000)).toBe(true);

		const delivered = notifications(harness);
		expect(delivered.map((message) => message.details?.event)).toEqual(["output", "finished"]);
		expect(delivered[0].content).toContain("server-ready");
		expect(lastAssistantText(harness)).toBe("Monitor ended.");
	});

	it("stops tasks at the wait timeout and when the session is disposed", async () => {
		const harness = await setup();
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("monitor", { command: "sleep 5", description: "long" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Watching."),
			fauxAssistantMessage(fauxToolCall("monitor", { command: "sleep 5", description: "second" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Watching again."),
		]);

		await harness.session.prompt("watch");
		expect(await harness.session.waitForBackgroundTasks(100)).toBe(false);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(harness.session.tasks.get("m1")?.status).toBe("stopped");
		expect(notifications(harness)).toHaveLength(0);

		await harness.session.prompt("again");
		expect(harness.session.tasks.get("m2")?.status).toBe("running");
		const outputFile = harness.session.tasks.get("m2")?.outputFile;
		harness.session.dispose();
		harnesses.splice(harnesses.indexOf(harness), 1);
		harness.cleanup();
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(harness.session.tasks.get("m2")?.status).toBe("stopped");
		if (outputFile && existsSync(outputFile)) cleanupPaths.push(outputFile);
	});
});
