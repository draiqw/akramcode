import {
	type Component,
	Container,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	visibleWidth,
	wrapTextWithAnsi,
} from "@akramcode/tui";
import { type ThemeColor, theme } from "../theme/theme.ts";
import { type AssistantMessageComponent, formatThinkingDuration } from "./assistant-message.ts";
import { keyText } from "./keybinding-hints.ts";
import type { ToolExecutionComponent } from "./tool-execution.ts";
import { summarizeToolGroup } from "./tool-group-summary.ts";

/** A piece of the summary line: its text and the separator printed after it when more follows. */
interface SummaryPart {
	text: string;
	color: ThemeColor;
	/** Printed after the text when another part follows, e.g. "," or " ·". */
	separator: string;
}

/** Splits "Read 2 files, ran 1 shell command" into pieces that end at ", ", so wrapping keeps each count whole. */
function listParts(text: string, color: ThemeColor, separator: string): SummaryPart[] {
	const items = text.split(", ");
	return items.map((item, index) => ({ text: item, color, separator: index < items.length - 1 ? "," : separator }));
}

/**
 * Wraps summary parts to width, breaking between parts where possible. Each line opens and closes its own colors,
 * so the caller can prefix a pad without carrying styles across lines.
 */
function wrapSummaryParts(parts: readonly SummaryPart[], width: number, separatorColor: ThemeColor): string[] {
	const lines: string[] = [];
	let line = "";
	let lineWidth = 0;
	parts.forEach((part, index) => {
		const separator = index < parts.length - 1 ? part.separator : "";
		const piece = theme.fg(part.color, part.text) + (separator ? theme.fg(separatorColor, separator) : "");
		const pieceWidth = visibleWidth(part.text + separator);
		if (lineWidth > 0 && lineWidth + 1 + pieceWidth <= width) {
			line += ` ${piece}`;
			lineWidth += 1 + pieceWidth;
			return;
		}
		if (lineWidth > 0) lines.push(line);
		// A single part wider than the line falls back to word wrapping.
		const wrapped = pieceWidth > width ? wrapTextWithAnsi(piece, width) : [piece];
		lines.push(...wrapped.slice(0, -1));
		line = wrapped[wrapped.length - 1] ?? "";
		lineWidth = visibleWidth(line);
	});
	if (lineWidth > 0 || lines.length === 0) lines.push(line);
	return lines;
}

/**
 * A run of consecutive tool calls. Collapsed, it renders a dim summary such as
 * "Read 2 files, ran 1 shell command · Running npm test… · 1 failed", wrapped over as many lines as it needs.
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

	/** Pointer is over the clickable summary or header lines, which brightens them to show they can be clicked. */
	private hovered = false;
	/** Lines the expanded header took in the last render; the tools start after the spacer and these lines. */
	private headerLines = 1;

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
		const tone = this.hovered ? "text" : "dim";
		if (!this.isCollapsed()) {
			const tools = this.toolsContainer.render(width);
			if (items.length === 0 || tools.length === 0) return tools;
			// The header says how to fold the group back, since nothing else on screen does.
			const key = keyText("app.tools.expand");
			const parts = listParts(summarizeToolGroup(items, this.getThoughtLabel()).done || "Tools", tone, " ·");
			if (key) parts.push({ text: `${key} to collapse`, color: tone, separator: "" });
			const header = wrapSummaryParts(parts, contentWidth, tone).map((line) => pad + line);
			this.headerLines = header.length;
			return ["", ...header, ...tools];
		}
		if (items.length === 0) {
			return [];
		}

		const summary = summarizeToolGroup(items, this.getThoughtLabel());
		const parts: SummaryPart[] = [];
		if (summary.done) parts.push(...listParts(summary.done, tone, " ·"));
		if (summary.active) parts.push({ text: `${summary.active}…`, color: tone, separator: " ·" });
		if (summary.failed > 0) parts.push({ text: `${summary.failed} failed`, color: "error", separator: "" });
		return ["", ...wrapSummaryParts(parts, contentWidth, tone).map((line) => pad + line)];
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "move" || event.type === "leave") {
			// The summary (collapsed) or header (expanded) starts on line 1, after the spacer line.
			const toolsTop = 1 + this.headerLines;
			const overToggle =
				event.type === "move" && (this.isCollapsed() ? event.y >= 1 : event.y >= 1 && event.y < toolsTop);
			const changed = overToggle !== this.hovered;
			this.hovered = overToggle;
			if (!overToggle && !this.isCollapsed() && event.type === "move" && event.y >= toolsTop) {
				return (
					this.toolsContainer.handleMouse({ ...event, y: event.y - toolsTop }) ?? {
						handled: true,
						render: changed,
					}
				);
			}
			return { handled: true, render: changed };
		}
		const isClick = event.type === "click" && event.button === "left";
		if (!this.isCollapsed()) {
			// The spacer and header lines come first; the tools start below them.
			const toolsTop = 1 + this.headerLines;
			if (event.y >= toolsTop) return this.toolsContainer.handleMouse({ ...event, y: event.y - toolsTop });
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
