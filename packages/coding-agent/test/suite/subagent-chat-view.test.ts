import { getCurrentSystemPrompt, type TranscriptContext } from "@akramcode/ai";
import { fauxAssistantMessage, fauxToolCall } from "@akramcode/providers";
import type { AssistantMessage, FauxResponseFactory } from "@akramcode/providers/compat";
import { type Component, type Container, Text, type TUI } from "@akramcode/tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAgentSession } from "../../src/core/sdk.ts";
import { DEFAULT_TOOL_NAMES } from "../../src/core/settings-manager.ts";
import { AssistantMessageComponent } from "../../src/modes/interactive/components/assistant-message.ts";
import {
	type ChatComponentFactory,
	SubagentChatView,
} from "../../src/modes/interactive/components/subagent-chat-view.ts";
import { ToolExecutionComponent } from "../../src/modes/interactive/components/tool-execution.ts";
import { getMarkdownTheme, initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

function isChild(context: TranscriptContext): boolean {
	return getCurrentSystemPrompt(context.messages).includes("You are a subagent");
}

function route(
	harness: Harness,
	parentSteps: AssistantMessage[],
	child: (context: TranscriptContext) => AssistantMessage | Promise<AssistantMessage>,
): void {
	let parentIndex = 0;
	const respond: FauxResponseFactory = (context) => {
		if (isChild(context)) return child(context);
		const step = parentSteps[parentIndex++];
		if (!step) throw new Error(`No parent response ${parentIndex}`);
		return step;
	};
	harness.setResponses(Array.from({ length: 20 }, () => respond));
}

const ui = { requestRender: () => {} } as unknown as TUI;

const factory: ChatComponentFactory = {
	userMessage: (text) => new Text(`USER: ${text}`, 0, 0),
	assistantMessage: () => new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking", 0, [], true),
	toolExecution: (toolName, toolCallId, args) =>
		new ToolExecutionComponent(toolName, toolCallId, args, {}, undefined, ui, "/repo"),
	addToolExecution: (container: Container, component: ToolExecutionComponent) => container.addChild(component),
};

function text(component: Component): string {
	return stripAnsi(component.render(120).join("\n"));
}

describe("SubagentChatView", () => {
	const harnesses: Harness[] = [];
	const views: SubagentChatView[] = [];

	beforeAll(() => {
		initTheme("dark");
	});

	afterEach(() => {
		for (const view of views.splice(0)) view.dispose();
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("shows an agent's conversation and follows a new run", async () => {
		const harness = await createHarness({
			createSubagentSession: createAgentSession,
			initialActiveToolNames: [...DEFAULT_TOOL_NAMES],
		});
		harnesses.push(harness);
		route(
			harness,
			[
				fauxAssistantMessage(fauxToolCall("agent", { description: "Inspect repo", prompt: "inspect the repo" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("Parent done."),
				fauxAssistantMessage("Parent saw the reply."),
			],
			(context) => {
				const last = context.messages.at(-1);
				if (last?.role === "toolResult") return fauxAssistantMessage("Inspected: 3 files.");
				const prompt = last ? getMessageText(last) : "";
				return prompt === "inspect the repo"
					? fauxAssistantMessage(fauxToolCall("bash", { command: "ls" }), { stopReason: "toolUse" })
					: fauxAssistantMessage(`Reply: ${prompt}`);
			},
		);
		await harness.session.prompt("go");

		const registry = harness.session.subagentRegistry;
		const session = registry.getSession("a1");
		if (!session) throw new Error("No agent session");
		const view = new SubagentChatView(registry, "a1", session, factory, () => {});
		views.push(view);
		const before = text(view);
		expect(before).toContain('Agent "Inspect repo" · general-purpose');
		expect(before).toContain("completed");
		expect(before).toContain("USER: inspect the repo");
		expect(before).toContain("ls");
		expect(before).toContain("Inspected: 3 files.");

		await registry.send("a1", "what about tests?", "user");
		await harness.session.waitForBackgroundTasks(10_000);
		await vi.waitFor(() => expect(text(view)).toContain("Reply: what about tests?"));
		expect(text(view)).toContain("USER: what about tests?");
	});
});
