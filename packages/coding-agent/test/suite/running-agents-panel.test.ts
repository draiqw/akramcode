import { getCurrentSystemPrompt, type TranscriptContext } from "@akramcode/ai";
import { fauxAssistantMessage, fauxToolCall } from "@akramcode/providers";
import type { AssistantMessage, FauxResponseFactory } from "@akramcode/providers/compat";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createAgentSession } from "../../src/core/sdk.ts";
import { DEFAULT_TOOL_NAMES } from "../../src/core/settings-manager.ts";
import { RunningAgentsPanel, trackRunningAgents } from "../../src/modes/interactive/components/running-agents-panel.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness, type Harness } from "./harness.ts";

function isChild(context: TranscriptContext): boolean {
	return getCurrentSystemPrompt(context.messages).includes("You are a subagent");
}

function hasToolResults(context: TranscriptContext): boolean {
	return context.messages.some((message) => message.role === "toolResult");
}

/** Route child requests to `child` and parent requests to the next of `parentSteps`. */
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

/** Agent lines, without the key hint. */
function lines(panel: RunningAgentsPanel): string[] {
	return panel
		.render(200)
		.map((line) => stripAnsi(line))
		.filter((line) => !line.includes("to switch chat"));
}

describe("running agents panel", () => {
	const harnesses: Harness[] = [];
	const stops: Array<() => void> = [];

	beforeAll(() => {
		initTheme("dark");
	});

	afterEach(() => {
		for (const stop of stops.splice(0)) stop();
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function setup(): Promise<{ harness: Harness; panel: RunningAgentsPanel }> {
		const harness = await createHarness({
			createSubagentSession: createAgentSession,
			initialActiveToolNames: [...DEFAULT_TOOL_NAMES],
		});
		harnesses.push(harness);
		const panel = new RunningAgentsPanel(() => {});
		stops.push(trackRunningAgents(harness.session.subagentRegistry, panel));
		return { harness, panel };
	}

	it("lists a foreground subagent while it runs and removes it when it finishes", async () => {
		const { harness, panel } = await setup();
		const seen: string[][] = [];
		route(
			harness,
			[
				fauxAssistantMessage(
					fauxToolCall("agent", { description: "List files", prompt: "List files.", subagent_type: "explore" }),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("Parent done."),
			],
			(context) => {
				seen.push(lines(panel));
				return hasToolResults(context)
					? fauxAssistantMessage("no files")
					: fauxAssistantMessage(fauxToolCall("bash", { command: "echo hi" }), { stopReason: "toolUse" });
			},
		);

		await harness.session.prompt("Use an agent.");

		expect(seen[0]).toEqual(["  ● explore: List files · 0s"]);
		expect(panel.render(200)).toEqual([]);
	});

	it("lists a background subagent", async () => {
		const { harness, panel } = await setup();
		let release: () => void = () => {};
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		route(
			harness,
			[
				fauxAssistantMessage(
					fauxToolCall("agent", { description: "Research", prompt: "research it", run_in_background: true }),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("Started research."),
				fauxAssistantMessage("Research finished."),
			],
			async () => {
				await released;
				return fauxAssistantMessage("findings");
			},
		);

		await harness.session.prompt("start");
		expect(lines(panel)).toEqual(["  ● general-purpose: Research · 0s"]);

		release();
		expect(await harness.session.waitForBackgroundTasks(10_000)).toBe(true);
		expect(panel.render(200)).toEqual([]);
	});
});
