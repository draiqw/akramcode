import {
	type Component,
	Container,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
} from "@akramcode/tui";
import { theme } from "../theme/theme.ts";
import { type AssistantMessageComponent, formatThinkingDuration } from "./assistant-message.ts";
import { keyText } from "./keybinding-hints.ts";
import type { ToolExecutionComponent } from "./tool-execution.ts";
import { summarizeToolGroup } from "./tool-group-summary.ts";

/**
 * A run of consecutive tool calls. Collapsed, it renders one dim summary line such as
 * "Read 2 files, ran 1 shell command · Running npm test… · 1 failed".
 * A click on the summary opens the group: a header with the collapse hint, then the folded thinking and one line
 * per call; a click on a call line shows that call's full output. app.tools.expand opens every call at once.
 * A click on the header collapses the group again.
 */
export class ToolGroupComponent implements Component {
	private readonly tools: ToolExecutionComponent[] = [];
	/** Assistant messages whose collapsed thinking this group summarizes. */
	private readonly thinking: AssistantMessageComponent[] = [];
	private readonly toolsContainer = new Container();
	private expanded: boolean;
	/** Set by a click on the summary or header; overrides the global expanded state until the next toggle. */
	private collapsedByClick: boolean | undefined;
	private outputPad: number;

	constructor(expanded: boolean, outputPad = 1) {
		this.expanded = expanded;
		this.outputPad = outputPad;
	}

	addTool(tool: ToolExecutionComponent): void {
		tool.setCompact(true);
		tool.setExpanded(this.expanded);
		this.tools.push(tool);
		this.toolsContainer.addChild(tool);
	}

	/** Fold in a message's thinking; call before adding the message's tool calls so expanded output keeps order. */
	addThinking(message: AssistantMessageComponent): void {
		if (this.thinking.includes(message)) return;
		message.setFoldedIntoGroup(true);
		this.thinking.push(message);
		this.toolsContainer.addChild({
			render: (width) => message.renderInGroup(width),
			invalidate: () => message.invalidate(),
		});
	}

	getTools(): readonly ToolExecutionComponent[] {
		return this.tools;
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.collapsedByClick = undefined;
		for (const tool of this.tools) {
			tool.setExpanded(expanded);
		}
	}

	/** Pointer is over the clickable summary or header line, which brightens it to show it can be clicked. */
	private hovered = false;

	private isCollapsed(): boolean {
		return this.collapsedByClick ?? !this.expanded;
	}

	invalidate(): void {
		this.toolsContainer.invalidate();
	}

	private getThoughtLabel(): string | undefined {
		if (this.thinking.length === 0) return undefined;
		// A reasoning summary title says what the model is doing, like the text Claude writes between tools.
		for (const message of [...this.thinking].reverse()) {
			const title = message.getThinkingTitle();
			if (title) return title;
		}
		let total: number | undefined;
		for (const message of this.thinking) {
			const ms = message.getThinkingMs();
			if (ms !== undefined) total = (total ?? 0) + ms;
		}
		return total === undefined ? "thought" : `thought for ${formatThinkingDuration(total)}`;
	}

	render(width: number): string[] {
		const items = this.tools.flatMap((tool) => {
			const item = tool.getSummaryItem();
			return item ? [item] : [];
		});
		const pad = " ".repeat(this.outputPad);
		const contentWidth = Math.max(1, width - this.outputPad);
		if (!this.isCollapsed()) {
			const tools = this.toolsContainer.render(width);
			if (items.length === 0 || tools.length === 0) return tools;
			// The header says how to fold the group back, since nothing else on screen does.
			const key = keyText("app.tools.expand");
			const header = `${summarizeToolGroup(items, this.getThoughtLabel()).done || "Tools"}${key ? ` · ${key} to collapse` : ""}`;
			return [
				"",
				pad + truncateToWidth(theme.fg(this.hovered ? "text" : "dim", header), contentWidth, "…"),
				...tools,
			];
		}
		if (items.length === 0) {
			return [];
		}

		const summary = summarizeToolGroup(items, this.getThoughtLabel());
		const tone = this.hovered ? "text" : "dim";
		const parts: string[] = [];
		if (summary.done) parts.push(theme.fg(tone, summary.done));
		if (summary.active) parts.push(theme.fg(tone, `${summary.active}…`));
		if (summary.failed > 0) parts.push(theme.fg("error", `${summary.failed} failed`));
		return ["", pad + truncateToWidth(parts.join(theme.fg(tone, " · ")), contentWidth, "…")];
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "move" || event.type === "leave") {
			// The summary (collapsed) or header (expanded) is on line 1, after the spacer line.
			const overToggle = event.type === "move" && (this.isCollapsed() ? event.y >= 1 : event.y === 1);
			const changed = overToggle !== this.hovered;
			this.hovered = overToggle;
			if (!overToggle && !this.isCollapsed() && event.type === "move" && event.y >= 2) {
				return this.toolsContainer.handleMouse({ ...event, y: event.y - 2 }) ?? { handled: true, render: changed };
			}
			return { handled: true, render: changed };
		}
		const isClick = event.type === "click" && event.button === "left";
		if (!this.isCollapsed()) {
			// Lines 0-1 are the spacer and header; the tools start below them.
			if (event.y >= 2) return this.toolsContainer.handleMouse({ ...event, y: event.y - 2 });
			if (!isClick) return undefined;
			this.collapsedByClick = true;
			for (const message of this.thinking) message.setExpanded(false);
			return { handled: true };
		}
		if (!isClick) return undefined;
		this.collapsedByClick = false;
		for (const message of this.thinking) message.setExpanded(true);
		return { handled: true };
	}
}
