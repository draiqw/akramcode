import {
	type Component,
	Container,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
} from "@akramcode/tui";
import { theme } from "../theme/theme.ts";
import type { ToolExecutionComponent } from "./tool-execution.ts";
import { summarizeToolGroup } from "./tool-group-summary.ts";

/**
 * A run of consecutive tool calls. Collapsed, it renders one dim summary line such as
 * "Read 2 files, ran 1 shell command · Running npm test…", plus a line per failed call.
 * Expanded (app.tools.expand, or a click on the summary), it renders the tool components unchanged.
 */
export class ToolGroupComponent implements Component {
	private readonly tools: ToolExecutionComponent[] = [];
	private readonly toolsContainer = new Container();
	private expanded: boolean;
	private openedByClick = false;
	private outputPad: number;

	constructor(expanded: boolean, outputPad = 1) {
		this.expanded = expanded;
		this.outputPad = outputPad;
	}

	addTool(tool: ToolExecutionComponent): void {
		tool.setExpanded(this.expanded);
		this.tools.push(tool);
		this.toolsContainer.addChild(tool);
	}

	getTools(): readonly ToolExecutionComponent[] {
		return this.tools;
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.openedByClick = false;
		for (const tool of this.tools) {
			tool.setExpanded(expanded);
		}
	}

	private isCollapsed(): boolean {
		return !this.expanded && !this.openedByClick;
	}

	invalidate(): void {
		this.toolsContainer.invalidate();
	}

	render(width: number): string[] {
		if (!this.isCollapsed()) {
			return this.toolsContainer.render(width);
		}
		const items = this.tools.flatMap((tool) => {
			const item = tool.getSummaryItem();
			return item ? [item] : [];
		});
		if (items.length === 0) {
			return [];
		}

		const summary = summarizeToolGroup(items);
		const parts: string[] = [];
		if (summary.done) parts.push(theme.fg("dim", summary.done));
		if (summary.active) parts.push(theme.fg("dim", `${summary.active}…`));
		if (summary.failed > 0) parts.push(theme.fg("error", `${summary.failed} failed`));
		const pad = " ".repeat(this.outputPad);
		const contentWidth = Math.max(1, width - this.outputPad);
		const lines = ["", pad + truncateToWidth(parts.join(theme.fg("dim", " · ")), contentWidth, "…")];
		for (const item of items) {
			if (item.status !== "error") continue;
			const detail = item.errorText ? `${item.toolName}: ${item.errorText}` : item.toolName;
			lines.push(pad + truncateToWidth(theme.fg("error", `  ✗ ${detail}`), contentWidth, "…"));
		}
		return lines;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (!this.isCollapsed()) return this.toolsContainer.handleMouse(event);
		if (event.type !== "click" || event.button !== "left") return undefined;
		this.openedByClick = true;
		return { handled: true };
	}
}
