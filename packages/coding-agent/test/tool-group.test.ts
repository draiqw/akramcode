import type { AssistantMessage } from "@akramcode/ai";
import { Container, type TUI, type TuiMouseEvent } from "@akramcode/tui";
import { beforeAll, describe, expect, test } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { ToolGroupComponent } from "../src/modes/interactive/components/tool-group.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const ui = { requestRender: () => {} } as unknown as TUI;

function createTool(toolName: string, args: Record<string, unknown>): ToolExecutionComponent {
	return new ToolExecutionComponent(toolName, `${toolName}-${Math.random()}`, args, {}, undefined, ui, process.cwd());
}

function render(group: ToolGroupComponent): string {
	return stripAnsi(group.render(100).join("\n"));
}

function click(): TuiMouseEvent {
	return {
		type: "click",
		button: "left",
		x: 1,
		y: 1,
		screenX: 1,
		screenY: 1,
		width: 100,
		height: 2,
		shift: false,
		alt: false,
		ctrl: false,
		clickCount: 1,
	};
}

describe("ToolGroupComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("collapses finished and running calls into one summary line", () => {
		const group = new ToolGroupComponent(false);
		const read = createTool("read", { path: "a.ts" });
		read.updateResult({ content: [{ type: "text", text: "FILE_CONTENT" }], isError: false });
		group.addTool(read);
		group.addTool(createTool("bash", { command: "npm test" }));

		const lines = group.render(100).map((line) => stripAnsi(line));
		expect(lines).toEqual(["", " Read 1 file · Running npm test…"]);
	});

	test("lists failed calls under the summary", () => {
		const group = new ToolGroupComponent(false);
		const bash = createTool("bash", { command: "false" });
		bash.updateResult({ content: [{ type: "text", text: "\ncommand failed: exit 1\nmore" }], isError: true });
		group.addTool(bash);

		expect(render(group)).toBe("\n Ran 1 shell command · 1 failed\n   ✗ bash: command failed: exit 1");
	});

	test("shows the full tool output when expanded and collapses again", () => {
		const group = new ToolGroupComponent(false);
		const read = createTool("read", { path: "a.ts" });
		read.updateResult({ content: [{ type: "text", text: "FILE_CONTENT" }], isError: false });
		group.addTool(read);
		expect(render(group)).not.toContain("FILE_CONTENT");

		group.setExpanded(true);
		expect(render(group)).toContain("FILE_CONTENT");

		group.setExpanded(false);
		expect(render(group)).not.toContain("FILE_CONTENT");
	});

	test("opens a single group on click", () => {
		const group = new ToolGroupComponent(false);
		const read = createTool("read", { path: "a.ts" });
		read.updateResult({ content: [{ type: "text", text: "FILE_CONTENT" }], isError: false });
		group.addTool(read);

		expect(group.handleMouse(click())?.handled).toBe(true);
		expect(render(group)).toContain("FILE_CONTENT");
	});

	test("starts expanded when tool output is expanded", () => {
		const group = new ToolGroupComponent(true);
		const read = createTool("read", { path: "a.ts" });
		read.updateResult({ content: [{ type: "text", text: "FILE_CONTENT" }], isError: false });
		group.addTool(read);

		expect(render(group)).toContain("FILE_CONTENT");
	});
});

type AddToolExecutionToChat = (this: GroupingThis, component: ToolExecutionComponent) => void;

interface GroupingThis {
	chatContainer: Container;
	toolOutputExpanded: boolean;
	outputPad: number;
	settingsManager: { getCollapseToolGroups(): boolean };
}

function assistant(content: AssistantMessage["content"]): AssistantMessageComponent {
	return new AssistantMessageComponent({
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: Date.now(),
	});
}

describe("InteractiveMode.addToolExecutionToChat", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	const addToolExecutionToChat = (
		InteractiveMode.prototype as unknown as { addToolExecutionToChat: AddToolExecutionToChat }
	).addToolExecutionToChat;

	function createThis(collapse = true): GroupingThis {
		return {
			chatContainer: new Container(),
			toolOutputExpanded: false,
			outputPad: 1,
			settingsManager: { getCollapseToolGroups: () => collapse },
		};
	}

	test("joins tool calls across assistant messages that render nothing", () => {
		const fakeThis = createThis();
		fakeThis.chatContainer.addChild(assistant([{ type: "toolCall", id: "1", name: "read", arguments: {} }]));
		addToolExecutionToChat.call(fakeThis, createTool("read", { path: "a.ts" }));
		fakeThis.chatContainer.addChild(assistant([{ type: "toolCall", id: "2", name: "bash", arguments: {} }]));
		addToolExecutionToChat.call(fakeThis, createTool("bash", { command: "ls" }));

		const groups = fakeThis.chatContainer.children.filter((child) => child instanceof ToolGroupComponent);
		expect(groups).toHaveLength(1);
		expect((groups[0] as ToolGroupComponent).getTools()).toHaveLength(2);
	});

	test("starts a new group after assistant text", () => {
		const fakeThis = createThis();
		addToolExecutionToChat.call(fakeThis, createTool("read", { path: "a.ts" }));
		fakeThis.chatContainer.addChild(assistant([{ type: "text", text: "Now I will run the tests." }]));
		addToolExecutionToChat.call(fakeThis, createTool("bash", { command: "npm test" }));

		expect(fakeThis.chatContainer.children.filter((child) => child instanceof ToolGroupComponent)).toHaveLength(2);
	});

	test("adds tool components directly when grouping is off", () => {
		const fakeThis = createThis(false);
		const tool = createTool("read", { path: "a.ts" });
		addToolExecutionToChat.call(fakeThis, tool);

		expect(fakeThis.chatContainer.children).toEqual([tool]);
	});
});
