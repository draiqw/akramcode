import {
	type Component,
	Container,
	type Focusable,
	getKeybindings,
	truncateToWidth,
	visibleWidth,
} from "@akramcode/tui";
import type { StackItem, StackStatus, StackTab } from "../../../core/stack.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { formatTokens } from "./footer.ts";
import { keyHint } from "./keybinding-hints.ts";

const MAX_VISIBLE_ROWS = 12;
const SCOPE_WIDTH = 9;
const STATUS_WIDTH = 11;
const TOKENS_WIDTH = 7;

function statusMark(status: StackStatus): string {
	switch (status) {
		case "active":
		case "manual":
			return theme.fg("success", "●");
		case "overridden":
			return theme.fg("warning", "↓");
		default:
			return theme.fg("dim", "○");
	}
}

function padEnd(text: string, width: number): string {
	const truncated = truncateToWidth(text, width, "…");
	return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

/** Tab body of `/stack`: one tab per item type, a row per item, enter shows its details. */
class StackViewerBody implements Component, Focusable {
	focused = false;
	private readonly tabs: StackTab[];
	private readonly onClose: () => void;
	private readonly requestRender: () => void;
	private tabIndex = 0;
	private selected = 0;
	private scroll = 0;
	private expanded = false;

	constructor(tabs: StackTab[], onClose: () => void, requestRender: () => void) {
		this.tabs = tabs;
		this.onClose = onClose;
		this.requestRender = requestRender;
	}

	private get items(): StackItem[] {
		return this.tabs[this.tabIndex]?.items ?? [];
	}

	private switchTab(delta: number): void {
		this.tabIndex = (this.tabIndex + delta + this.tabs.length) % this.tabs.length;
		this.selected = 0;
		this.scroll = 0;
		this.expanded = false;
	}

	private move(delta: number): void {
		const count = this.items.length;
		if (count === 0) return;
		this.selected = Math.max(0, Math.min(count - 1, this.selected + delta));
		if (this.selected < this.scroll) this.scroll = this.selected;
		if (this.selected >= this.scroll + MAX_VISIBLE_ROWS) this.scroll = this.selected - MAX_VISIBLE_ROWS + 1;
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.cancel")) {
			this.onClose();
			return;
		}
		if (kb.matches(data, "tui.input.tab") || kb.matches(data, "tui.editor.cursorRight")) this.switchTab(1);
		else if (kb.matches(data, "tui.editor.cursorLeft")) this.switchTab(-1);
		else if (kb.matches(data, "tui.select.up")) this.move(-1);
		else if (kb.matches(data, "tui.select.down")) this.move(1);
		else if (kb.matches(data, "tui.select.pageUp")) this.move(-MAX_VISIBLE_ROWS);
		else if (kb.matches(data, "tui.select.pageDown")) this.move(MAX_VISIBLE_ROWS);
		else if (kb.matches(data, "tui.select.confirm")) this.expanded = !this.expanded;
		else return;
		this.requestRender();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const tabLabels = this.tabs.map((tab, index) =>
			index === this.tabIndex ? theme.fg("accent", theme.bold(tab.label)) : theme.fg("muted", tab.label),
		);
		const lines = [truncateToWidth(` ${theme.bold("Stack")}  ${tabLabels.join("  ")}`, width), ""];

		const items = this.items;
		const longestName = Math.max(4, ...items.map((item) => visibleWidth(item.name)));
		const nameWidth = Math.max(
			8,
			Math.min(longestName + 2, width - 4 - SCOPE_WIDTH - STATUS_WIDTH - TOKENS_WIDTH - 3),
		);
		const columns = (name: string, scope: string, status: string, tokens: string) =>
			`${padEnd(name, nameWidth)} ${padEnd(scope, SCOPE_WIDTH)} ${padEnd(status, STATUS_WIDTH)} ${tokens.padStart(TOKENS_WIDTH)}`;
		lines.push(truncateToWidth(theme.fg("dim", `    ${columns("name", "scope", "status", "tokens")}`), width));

		if (items.length === 0) lines.push(theme.fg("dim", "    (none)"));
		for (const [offset, item] of items.slice(this.scroll, this.scroll + MAX_VISIBLE_ROWS).entries()) {
			const index = this.scroll + offset;
			const isSelected = index === this.selected;
			const tokens = item.tokens === undefined ? "-" : `~${formatTokens(item.tokens)}`;
			const row = columns(item.name, item.scope, item.status, tokens);
			const cursor = isSelected ? theme.fg("accent", "→") : " ";
			const text = isSelected ? theme.fg("accent", row) : item.status === "active" ? row : theme.fg("muted", row);
			lines.push(truncateToWidth(`${cursor} ${statusMark(item.status)} ${text}`, width));
			if (isSelected && this.expanded) {
				for (const detail of item.details.filter(Boolean)) {
					lines.push(truncateToWidth(theme.fg("dim", `      ${detail.replace(/\s+/g, " ")}`), width, "…"));
				}
			}
		}
		if (items.length > MAX_VISIBLE_ROWS) {
			lines.push(theme.fg("dim", `    ${this.selected + 1}/${items.length}`));
		}

		const tab = this.tabs[this.tabIndex];
		const total = items.reduce((sum, item) => sum + (item.tokens ?? 0), 0);
		const summary = `${items.length} ${tab?.noun ?? ""}${total > 0 ? ` · ~${formatTokens(total)} tok in system prompt` : ""}`;
		lines.push("", truncateToWidth(theme.fg("muted", ` ${summary}`), width));
		const hints = [
			keyHint("tui.input.tab", "next type"),
			keyHint("tui.select.confirm", "details"),
			keyHint("tui.select.cancel", "close"),
		].join(theme.fg("dim", "  "));
		lines.push(truncateToWidth(` ${hints}`, width));
		return lines;
	}
}

/** `/stack`: everything loaded into the session, by type, with its level, status, and token cost. */
export class StackViewerComponent extends Container {
	private readonly body: StackViewerBody;

	constructor(tabs: StackTab[], onClose: () => void, requestRender: () => void) {
		super();
		this.body = new StackViewerBody(tabs, onClose, requestRender);
		this.addChild(new DynamicBorder());
		this.addChild(this.body);
		this.addChild(new DynamicBorder());
	}

	getFocusTarget(): Component {
		return this.body;
	}
}
