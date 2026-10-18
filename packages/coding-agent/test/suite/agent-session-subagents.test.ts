import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCurrentSystemPrompt, getCurrentTools, type TranscriptContext } from "@akramcode/ai";
import { fauxAssistantMessage, fauxToolCall } from "@akramcode/providers";
import type { AssistantMessage, FauxResponseFactory, ToolResultMessage } from "@akramcode/providers/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
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

	it("activates agent and task_stop by default and honors the settings", async () => {
		const harness = await setup();
		expect(harness.session.getActiveToolNames()).toEqual(expect.arrayContaining(["agent", "task_stop"]));
		expect(harness.session.getAllTools().map((tool) => tool.name)).not.toContain("monitor");
		const agentTool = harness.session.getToolDefinition("agent");
		expect(Object.keys(schemaProperties(agentTool?.parameters))).toContain("run_in_background");
		expect(agentTool?.description).toContain("general-purpose (default), explore");
		expect(Object.keys(schemaProperties(harness.session.getToolDefinition("bash")?.parameters))).toEqual(
			expect.arrayContaining(["run_in_background", "monitor"]),
		);

		const noSubagents = await setup({ subagents: { enabled: false } });
		expect(noSubagents.session.getActiveToolNames()).not.toContain("agent");
		expect(noSubagents.session.getActiveToolNames()).toContain("task_stop");

		const noBackground = await setup({ backgroundTasks: { enabled: false } });
		expect(noBackground.session.getActiveToolNames()).toContain("agent");
		expect(noBackground.session.getActiveToolNames()).not.toContain("task_stop");
		expect(Object.keys(schemaProperties(noBackground.session.getToolDefinition("agent")?.parameters))).not.toContain(
			"run_in_background",
		);
		expect(Object.keys(schemaProperties(noBackground.session.getToolDefinition("bash")?.parameters))).not.toContain(
			"monitor",
		);
		// Monitors are a mode of bash: a session without bash cannot run shell commands in the background.
		const noBash = await createHarness({ createSubagentSession: createAgentSession, excludedToolNames: ["bash"] });
		harnesses.push(noBash);
		expect(noBash.session.getAllTools().map((tool) => tool.name)).not.toEqual(expect.arrayContaining(["bash"]));
		expect(noBash.session.getAllTools().map((tool) => tool.name)).not.toContain("monitor");
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
					: fauxAssistantMessage(fauxToolCall("bash", { command: "echo hi" }), { stopReason: "toolUse" }),
		);
		const originalPrompt = "List the files in the working directory.";

		await harness.session.prompt("Use an agent.");

		expect(childRequests.length).toBe(2);
		expect(childRequests[0].prompt).toBe(originalPrompt);
		// Fresh context: the child never sees the parent's user message.
		expect(childRequests[0].systemPrompt).toContain("You are a read-only explorer");
		// explore lists read, grep, find, ls, and bash; the parent has only read and bash active.
		expect(childRequests[0].tools.sort()).toEqual(["bash", "read"]);

		const [result] = toolResults(harness, "agent");
		expect(result.isError).toBe(false);
		expect(getMessageText(result)).toBe("Child report: no files.");
		const details = result.details as unknown as AgentToolDetails;
		expect(details).toMatchObject({
			agentType: "explore",
			status: "completed",
			toolUses: 1,
			activity: ["$ echo hi"],
		});
		expect(details.usage.turns).toBe(2);
		expect(lastAssistantText(harness)).toBe("Parent done.");
		expect(details.transcriptFile).toBeDefined();
		if (details.transcriptFile) {
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
			(request) =>
				request.hasToolResults
					? fauxAssistantMessage("worked")
					: fauxAssistantMessage(
							fauxToolCall("bash", { command: "echo fg", run_in_background: true, monitor: true }),
							{ stopReason: "toolUse" },
						),
		);

		await harness.session.prompt("go");

		expect(childRequests[0].tools.sort()).toEqual(["bash", "edit", "read", "write"]);
		// Background parameters are removed from the child's bash, and stripped if sent anyway.
		expect(childRequests[0].hasToolResults).toBe(false);
		expect(harness.session.tasks.list()).toEqual([]);
	});

	it("gives subagents only tools the parent session can call, through the parent's tool hooks", async () => {
		const toolCalls: Array<{ name: string; parent?: string }> = [];
		const policy = (akramcode: ExtensionAPI) => {
			akramcode.on("tool_call", (event) => {
				toolCalls.push({ name: event.toolName, parent: event.parentToolCallId });
				if (event.toolName === "bash") return { block: true, reason: "bash is blocked by policy" };
				return undefined;
			});
		};
		const harness = await createHarness({
			createSubagentSession: createAgentSession,
			extensionFactories: [policy],
			// The parent runs without edit and write (as with --tools read,bash,agent).
			initialActiveToolNames: ["read", "bash", "agent"],
		});
		harnesses.push(harness);
		await harness.session.bindExtensions({});
		const agentsDir = join(harness.tempDir, "agent", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "writer.md"),
			"---\nname: writer\ndescription: Writes\ntools: write, edit, bash, grep, mcp__*\n---\nWrite.\n",
		);
		harness.session.subagents?.reload();

		const childRequests = route(
			harness,
			[
				fauxAssistantMessage(
					[
						fauxToolCall("agent", { description: "General", prompt: "general" }, { id: "agent-general" }),
						fauxToolCall(
							"agent",
							{ description: "Writer", prompt: "writer", subagent_type: "writer" },
							{
								id: "agent-writer",
							},
						),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("done"),
			],
			(request) => {
				if (request.hasToolResults) return fauxAssistantMessage("finished");
				return fauxAssistantMessage(fauxToolCall("bash", { command: "touch escaped" }), { stopReason: "toolUse" });
			},
		);
		await harness.session.prompt("go");

		const toolsByPrompt = Object.fromEntries(
			childRequests.filter((r) => !r.hasToolResults).map((r) => [r.prompt, r.tools.sort()]),
		);
		// Without a tool list: the parent's active tools, minus agent tools.
		expect(toolsByPrompt.general).toEqual(["bash", "read"]);
		// write, edit, grep, and MCP tools are not active in the parent, so the allowlist cannot add them.
		expect(toolsByPrompt.writer).toEqual(["bash"]);
		const writer = harness.session.subagents?.listTypes().types.find((type) => type.name === "writer");
		expect(writer && harness.session.subagents?.resolveTools(writer).unknown).toEqual([
			"write",
			"edit",
			"grep",
			"mcp__*",
		]);
		// The child's bash calls went through the parent's tool_call hook, which blocked them.
		const childBash = toolCalls.filter((call) => call.name === "bash");
		expect(childBash.map((call) => call.parent).sort()).toEqual(["agent-general", "agent-writer"]);
		expect(existsSync(join(harness.tempDir, "escaped"))).toBe(false);
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

	it("gives custom agent types the extension and MCP tools the parent can call", async () => {
		const executed: string[] = [];
		const registerTools = (akramcode: ExtensionAPI) => {
			for (const [name, exposure] of [
				["web_fetch", "direct"],
				["mcp__gh__issues", "direct"],
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
			"---\nname: triager\ndescription: Triages issues\ntools: read, mcp__*, web_fetch, nope\ndisallowedTools: web_fetch\nthinking: off\n---\nTriage issues.\n",
		);
		// The definition was written after the session started: reload it as `/agents` does.
		const control = harness.session.subagents;
		control?.reload();
		const triager = control?.listTypes().types.find((type) => type.name === "triager");
		// mcp__slack__post (codemode) is not reachable: codemode is not active in the parent. Deferred
		// tools such as mcp__gh__pulls are loaded by naming them.
		expect(triager && control?.resolveTools(triager)).toEqual({
			tools: ["read", "mcp__gh__issues", "mcp__gh__pulls"],
			unknown: ["nope"],
		});
		expect(harness.session.agent.state.tools.find((tool) => tool.name === "agent")?.description).toContain(
			"\n- triager: Triages issues",
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

		expect(childRequests[0].tools.sort()).toEqual(["mcp__gh__issues", "mcp__gh__pulls", "read"]);
		expect(childRequests[0].systemPrompt).toContain("Triage issues.");
		// The parent's MCP tool really runs for the child.
		expect(executed).toEqual(["mcp__gh__issues"]);
		const details = toolResults(harness, "agent")[0].details as unknown as AgentToolDetails;
		expect(details.activity).toEqual(["mcp__gh__issues {}"]);
	});

	it("lists project agents", async () => {
		const harness = await setup();
		const projectAgents = join(harness.tempDir, ".akramcode", "agents");
		mkdirSync(projectAgents, { recursive: true });
		writeFileSync(join(projectAgents, "proj.md"), "---\nname: proj\ndescription: Project agent\n---\nDo it.\n");
		const names = () => harness.session.subagents?.listTypes().types.map((type) => type.name);
		harness.session.subagents?.reload();
		expect(names()).toEqual(["general-purpose", "explore", "proj"]);
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
				fauxToolCall("bash", { command: "sleep 0.2; echo server-ready", run_in_background: true, monitor: true }),
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

	it("delivers notifications queued during a turn together in the next turn", async () => {
		const harness = await setup();
		let releaseFirst = () => {};
		const firstReleased = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const requests: string[] = [];
		const respond =
			(text: string, gate?: Promise<void>): FauxResponseFactory =>
			async (context) => {
				requests.push(context.messages.map((message) => getMessageText(message)).join("\n"));
				await gate;
				return fauxAssistantMessage(text);
			};
		harness.setResponses([respond("Working.", firstReleased), respond("Both seen.")]);

		const running = harness.session.prompt("go");
		await new Promise((resolve) => setTimeout(resolve, 20));
		const monitor = harness.session.tasks.create({ kind: "monitor", description: "watch" });
		monitor.emitOutput(["line 1"]);
		await monitor.finish({ status: "completed", exitCode: 0 });
		releaseFirst();
		await running;
		await harness.session.waitForIdle();

		// One request carries the output and the completion; the model never sees m1 as still running alone.
		expect(requests).toHaveLength(2);
		expect(requests[1]).toContain("line 1");
		expect(requests[1]).toContain("<status>completed</status>");
		expect(notifications(harness).map((message) => message.details?.event)).toEqual(["output", "finished"]);
		expect(lastAssistantText(harness)).toBe("Both seen.");
	});

	it("holds task notifications after an abort until the next prompt", async () => {
		const harness = await setup();
		const requests: string[] = [];
		const waitForAbort: FauxResponseFactory = async (context, options) => {
			requests.push(context.messages.map((message) => getMessageText(message)).join("\n"));
			await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve()));
			return fauxAssistantMessage("never shown");
		};
		const answer: FauxResponseFactory = (context) => {
			requests.push(context.messages.map((message) => getMessageText(message)).join("\n"));
			return fauxAssistantMessage("Answered.");
		};
		harness.setResponses([waitForAbort, answer]);

		const running = harness.session.prompt("watch");
		await new Promise((resolve) => setTimeout(resolve, 20));
		const command = harness.session.tasks.create({ kind: "bash", description: "npm test" });
		await command.finish({ status: "completed", exitCode: 0 });
		// Escape clears the user's queued messages and aborts; the queued notification must survive both.
		harness.session.clearQueue();
		await harness.session.abort();
		await running;

		const monitor = harness.session.tasks.create({ kind: "monitor", description: "watch" });
		for (let i = 1; i <= 8; i++) monitor.emitOutput([`evt${i}`]);
		await new Promise((resolve) => setTimeout(resolve, 50));
		// No turn started: Escape returned control even though the monitor keeps producing output.
		expect(requests).toHaveLength(1);
		expect(harness.eventsOfType("agent_start")).toHaveLength(1);
		expect(notifications(harness)).toHaveLength(0);

		await harness.session.prompt("what happened?");
		expect(requests).toHaveLength(2);
		// Only the newest output notifications are kept; older lines stay in the output file.
		expect(requests[1]).toContain("what happened?");
		expect(requests[1]).toContain('Background command "npm test" completed');
		expect(requests[1]).toContain("evt8");
		expect(requests[1]).toContain("evt4");
		expect(requests[1]).not.toContain("evt3");
		// The held notifications come before the prompt, so the model answers the prompt.
		expect(requests[1].indexOf("evt8")).toBeLessThan(requests[1].lastIndexOf("what happened?"));
		expect(notifications(harness)).toHaveLength(6);

		// The prompt resumed automatic delivery.
		harness.appendResponses([fauxAssistantMessage("Saw it.")]);
		await monitor.finish({ status: "completed" });
		await harness.session.waitForBackgroundTasks(5_000);
		expect(lastAssistantText(harness)).toBe("Saw it.");
	});

	it("queues a prompt when a notification starts a run during the prompt's preflight", async () => {
		let releaseHook = () => {};
		const hookReleased = new Promise<void>((resolve) => {
			releaseHook = resolve;
		});
		let markHookStarted = () => {};
		const hookStarted = new Promise<void>((resolve) => {
			markHookStarted = resolve;
		});
		const harness = await setup(undefined, [
			(akramcode) => {
				akramcode.on("before_agent_start", async () => {
					markHookStarted();
					await hookReleased;
				});
			},
		]);
		const requests: string[] = [];
		const respond =
			(text: string): FauxResponseFactory =>
			(context) => {
				requests.push(context.messages.map((message) => getMessageText(message)).join("\n"));
				return fauxAssistantMessage(text);
			};
		harness.setResponses([respond("Noted the task."), respond("Answered.")]);

		const prompting = harness.session.prompt("my question");
		await hookStarted;
		const command = harness.session.tasks.create({ kind: "bash", description: "build" });
		await command.finish({ status: "completed", exitCode: 0 });
		await new Promise((resolve) => setTimeout(resolve, 10));
		releaseHook();
		await prompting;
		await harness.session.waitForIdle();

		expect(requests).toHaveLength(2);
		expect(requests[0]).toContain('Background command "build" completed');
		expect(requests[1]).toContain("my question");
		expect(lastAssistantText(harness)).toBe("Answered.");
	});

	it("ends the pause with a queued user prompt but not with an extension message", async () => {
		const harness = await setup();
		const requests: string[] = [];
		let releaseRun = () => {};
		const record =
			(text: string, gate?: () => Promise<void>): FauxResponseFactory =>
			async (context, options) => {
				requests.push(context.messages.map((message) => getMessageText(message)).join("\n"));
				if (gate) await gate();
				else if (text === "aborted")
					await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve()));
				return fauxAssistantMessage(text);
			};
		harness.setResponses([
			record("aborted"),
			record("Extension answered."),
			record(
				"Busy.",
				() =>
					new Promise<void>((resolve) => {
						releaseRun = resolve;
					}),
			),
			record("Saw the build."),
			record("Answered the user."),
		]);

		const running = harness.session.prompt("start");
		await new Promise((resolve) => setTimeout(resolve, 20));
		await harness.session.abort();
		await running;
		const command = harness.session.tasks.create({ kind: "bash", description: "build" });
		await command.finish({ status: "completed", exitCode: 0 });

		// An extension message runs a turn but leaves the notification held.
		await harness.session.sendUserMessage("extension note");
		expect(requests[1]).toContain("extension note");
		expect(requests[1]).not.toContain('Background command "build"');

		// A run not started by the user; the user's message is queued during it and ends the pause.
		const busy = harness.session.sendCustomMessage(
			{ customType: "test", content: "busy work", display: false },
			{ triggerTurn: true },
		);
		await vi.waitFor(() => expect(requests).toHaveLength(3));
		await harness.session.prompt("user question", { streamingBehavior: "followUp" });
		releaseRun();
		await busy;
		await harness.session.waitForIdle();

		expect(requests).toHaveLength(5);
		expect(requests[3]).toContain('Background command "build" completed');
		expect(requests[3]).not.toContain("user question");
		expect(requests[4]).toContain("user question");
		expect(lastAssistantText(harness)).toBe("Answered the user.");
	});

	/** A session with history to compact whose compaction waits until `releaseCompaction()`. */
	async function setupBlockedCompaction() {
		let releaseCompaction = () => {};
		const compactionReleased = new Promise<void>((resolve) => {
			releaseCompaction = resolve;
		});
		let markCompactionStarted = () => {};
		const compactionStarted = new Promise<void>((resolve) => {
			markCompactionStarted = resolve;
		});
		const harness = await setup({ compaction: { keepRecentTokens: 1 } }, [
			(akramcode) => {
				akramcode.on("session_before_compact", async (event) => {
					markCompactionStarted();
					await compactionReleased;
					return {
						compaction: {
							summary: "compacted",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
							details: {},
						},
					};
				});
			},
		]);
		const timestamp = Date.now();
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "old user message" }],
			timestamp: timestamp - 1000,
		});
		harness.sessionManager.appendMessage(fauxAssistantMessage("old answer", { timestamp: timestamp - 500 }));
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
		const requests: string[] = [];
		const respond =
			(text: string): FauxResponseFactory =>
			(context) => {
				requests.push(context.messages.map((message) => getMessageText(message)).join("\n"));
				return fauxAssistantMessage(text);
			};
		const compacting = harness.session.compact().catch(() => undefined);
		await compactionStarted;
		const command = harness.session.tasks.create({ kind: "bash", description: "build" });
		await command.finish({ status: "completed", exitCode: 0 });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(harness.eventsOfType("agent_start")).toHaveLength(0);
		return { harness, requests, respond, compacting, releaseCompaction };
	}

	it("holds notifications during manual compaction and delivers them afterwards", async () => {
		const { harness, respond, compacting, releaseCompaction } = await setupBlockedCompaction();
		harness.setResponses([respond("Saw the build.")]);

		releaseCompaction();
		await compacting;
		await vi.waitFor(() => expect(lastAssistantText(harness)).toBe("Saw the build."));
		expect(notifications(harness)).toHaveLength(1);
	});

	it("sends notifications held during compaction with a prompt submitted when compaction ends", async () => {
		const { harness, requests, respond, compacting, releaseCompaction } = await setupBlockedCompaction();
		harness.setResponses([respond("Answered."), respond("unexpected")]);

		releaseCompaction();
		await compacting;
		await harness.session.prompt("queued during compaction");
		await harness.session.waitForIdle();

		// One turn: the notification first, then the user's message.
		expect(requests).toHaveLength(1);
		expect(requests[0].indexOf('Background command "build"')).toBeLessThan(
			requests[0].lastIndexOf("queued during compaction"),
		);
	});

	it("does not start a turn when the user cancels compaction", async () => {
		const { harness, requests, respond, compacting, releaseCompaction } = await setupBlockedCompaction();
		harness.setResponses([respond("Next."), respond("unexpected")]);

		harness.session.abortCompaction();
		releaseCompaction();
		await compacting;
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(harness.eventsOfType("agent_start")).toHaveLength(0);

		await harness.session.prompt("next");
		expect(requests).toHaveLength(1);
		expect(requests[0]).toContain('Background command "build" completed');
	});

	it("stops tasks at the print-mode timeout even while a monitor keeps producing output", async () => {
		const harness = await setup();
		// Each turn takes longer than the gap between notifications, so one is always pending after a turn.
		const slowAnswer: FauxResponseFactory = async () => {
			await new Promise((resolve) => setTimeout(resolve, 60));
			return fauxAssistantMessage("ok");
		};
		harness.setResponses(Array.from({ length: 200 }, () => slowAnswer));
		const monitor = harness.session.tasks.create({ kind: "monitor", description: "endless" });
		let line = 0;
		const timer = setInterval(() => monitor.emitOutput([`line ${++line}`]), 15);
		monitor.signal.addEventListener("abort", () => {
			clearInterval(timer);
			void monitor.finish({ status: "completed" });
		});

		const started = Date.now();
		expect(await harness.session.waitForBackgroundTasks(300)).toBe(false);
		clearInterval(timer);

		// Before the fix, every pending notification skipped the deadline check and the wait never ended.
		expect(Date.now() - started).toBeLessThan(3000);
		await vi.waitFor(() => expect(harness.session.tasks.get(monitor.id)?.status).toBe("stopped"));
	});

	it("does not pause notifications for an abort that is not a user interrupt", async () => {
		const harness = await setup(undefined, [
			(akramcode) => {
				akramcode.on("tool_call", (_event, ctx) => {
					ctx.abort();
				});
			},
		]);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "true" }), { stopReason: "toolUse" }),
			// Taken by the aborted run.
			fauxAssistantMessage("Aborted."),
			fauxAssistantMessage("Saw the task."),
		]);

		await harness.session.prompt("go");
		await harness.session.waitForIdle();
		const command = harness.session.tasks.create({ kind: "bash", description: "build" });
		await command.finish({ status: "completed", exitCode: 0 });
		await harness.session.waitForBackgroundTasks(5_000);

		expect(lastAssistantText(harness)).toBe("Saw the task.");
	});

	it("stops tasks at the wait timeout and when the session is disposed", async () => {
		const harness = await setup();
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "sleep 5", run_in_background: true, monitor: true }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Watching."),
			fauxAssistantMessage(fauxToolCall("bash", { command: "sleep 5", run_in_background: true, monitor: true }), {
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
