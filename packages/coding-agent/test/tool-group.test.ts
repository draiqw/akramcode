import type { AssistantMessage } from "@akramcode/ai";
import { Container, setKeybindings, type TUI, type TuiMouseEvent } from "@akramcode/tui";
import { beforeAll, describe, expect, test } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
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
		setKeybindings(new KeybindingsManager());
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

	test("counts failed calls without showing the error", () => {
		const group = new ToolGroupComponent(false);
		const bash = createTool("bash", { command: "false" });
		bash.updateResult({ content: [{ type: "text", text: "\ncommand failed: exit 1\nmore" }], isError: true });
		group.addTool(bash);

		expect(render(group)).toBe("\n Ran 1 shell command · 1 failed");
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

	test("a click opens the group as one line per call, a click on a line shows its output", () => {
		const group = new ToolGroupComponent(false);
		const read = createTool("read", { path: "a.ts" });
		read.updateResult({ content: [{ type: "text", text: "FILE_CONTENT" }], isError: false });
		group.addTool(read);
		const bash = createTool("bash", { command: "false" });
		bash.updateResult({ content: [{ type: "text", text: "exit 1" }], isError: true });
		group.addTool(bash);

		expect(group.handleMouse(click())?.handled).toBe(true);
		const lines = group.render(100).map((line) => stripAnsi(line).trimEnd());
		expect(lines.slice(2)).toEqual([' ✓ read path="a.ts"', ' ✗ bash command="false"']);

		// The second call line is on row 3: spacer, header, then one row per call.
		expect(group.handleMouse({ ...click(), y: 3, height: lines.length })?.handled).toBe(true);
		const opened = render(group);
		expect(opened).toContain("exit 1");
		expect(opened).not.toContain("FILE_CONTENT");

		// A click on the header folds it back.
		expect(group.handleMouse(click())?.handled).toBe(true);
		expect(render(group)).not.toContain("exit 1");
	});

	test("shows how to collapse above expanded output", () => {
		const group = new ToolGroupComponent(true);
		const read = createTool("read", { path: "a.ts" });
		read.updateResult({ content: [{ type: "text", text: "FILE_CONTENT" }], isError: false });
		group.addTool(read);

		const lines = group.render(100).map((line) => stripAnsi(line));
		expect(lines.slice(0, 2)).toEqual(["", " Read 1 file · ctrl+o to collapse"]);
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

function assistant(content: AssistantMessage["content"], hideThinkingBlock = false): AssistantMessageComponent {
	return new AssistantMessageComponent(
		{
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
		},
		hideThinkingBlock,
	);
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

	test("folds collapsed thinking into the group summary", () => {
		const fakeThis = createThis();
		const thinking = (id: string, name: string) =>
			assistant(
				[
					{ type: "thinking", thinking: "plan" },
					{ type: "toolCall", id, name, arguments: {} },
				],
				true,
			);
		const first = thinking("1", "read");
		fakeThis.chatContainer.addChild(first);
		const read = createTool("read", { path: "a.ts" });
		read.updateResult({ content: [{ type: "text", text: "x" }], isError: false });
		addToolExecutionToChat.call(fakeThis, read);
		fakeThis.chatContainer.addChild(thinking("2", "bash"));
		const bash = createTool("bash", { command: "ls" });
		bash.updateResult({ content: [{ type: "text", text: "a.ts" }], isError: false });
		addToolExecutionToChat.call(fakeThis, bash);

		const groups = fakeThis.chatContainer.children.filter((child) => child instanceof ToolGroupComponent);
		expect(groups).toHaveLength(1);
		const text = stripAnsi(fakeThis.chatContainer.render(100).join("\n"));
		expect(text.trim()).toBe("Thought, read 1 file, ran 1 shell command");

		// Expanded, the group shows the thinking after its header, before the call it led to.
		first.setExpanded(true);
		(groups[0] as ToolGroupComponent).setExpanded(true);
		const expanded = stripAnsi(fakeThis.chatContainer.render(100).join("\n"));
		expect(expanded.indexOf("ctrl+o to collapse")).toBeLessThan(expanded.indexOf("plan"));
		expect(expanded.indexOf("plan")).toBeLessThan(expanded.indexOf("a.ts"));
	});

	test("labels the group with the latest reasoning summary title", () => {
		const fakeThis = createThis();
		fakeThis.chatContainer.addChild(
			assistant(
				[
					{ type: "thinking", thinking: "**Checking home disk usage**\n\nLooking at ~" },
					{ type: "toolCall", id: "1", name: "bash", arguments: {} },
				],
				true,
			),
		);
		const bash = createTool("bash", { command: "du -sh ~" });
		bash.updateResult({ content: [{ type: "text", text: "1G" }], isError: false });
		addToolExecutionToChat.call(fakeThis, bash);

		const text = stripAnsi(fakeThis.chatContainer.render(100).join("\n"));
		expect(text.trim()).toBe("Checking home disk usage, ran 1 shell command");
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
