/**
 * The interactive dialog of the `question` tool: one tab per question, numbered options with
 * descriptions and previews, single or multiple choice, a free-text answer with `@file`
 * completion, and files or images attached by paste, drop, or `@` mention.
 */

import {
	type AutocompleteProvider,
	type Component,
	Editor,
	getKeybindings,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@akramcode/tui";
import { keyHint, rawKeyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import { getEditorTheme, type Theme } from "../../modes/interactive/theme/theme.ts";
import {
	attachmentLabel,
	attachmentsFromMentions,
	attachmentsFromPastedText,
	type QuestionAttachment,
} from "./attachments.ts";

export interface QuestionOption {
	label: string;
	description?: string;
	preview?: string;
}

export interface QuestionSpec {
	question: string;
	header?: string;
	options: QuestionOption[];
	multiSelect?: boolean;
}

export interface QuestionAnswer {
	/** Labels of the chosen options, in option order. */
	selected: string[];
	/** Text the user wrote, if any. */
	custom?: string;
	attachments: QuestionAttachment[];
}

/** `null` when the user cancelled. */
export type QuestionDialogResult = { answers: QuestionAnswer[] } | null;

/** What a clipboard paste produced: attachments, or plain text for the editor. */
export type ClipboardPaste = { attachments: QuestionAttachment[] } | { text: string } | null;

export interface QuestionDialogOptions {
	cwd: string;
	autocompleteProvider?: AutocompleteProvider;
	/** Reads the clipboard on the paste-image key. */
	readClipboard?: () => Promise<ClipboardPaste>;
	onError?: (message: string) => void;
}

interface QuestionState {
	cursor: number;
	selected: Set<number>;
	attachments: QuestionAttachment[];
	editor: Editor;
	answered: boolean;
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const MAX_PREVIEW_LINES = 16;

export class QuestionDialog implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly questions: QuestionSpec[];
	private readonly options: QuestionDialogOptions;
	private readonly done: (result: QuestionDialogResult) => void;
	private readonly states: QuestionState[];
	/** Index of the active tab; `questions.length` is the review tab when there are several questions. */
	private tab = 0;
	private reviewCursor = 0;
	private finished = false;
	private status: string | undefined;

	constructor(
		tui: TUI,
		theme: Theme,
		questions: QuestionSpec[],
		options: QuestionDialogOptions,
		done: (result: QuestionDialogResult) => void,
	) {
		this.tui = tui;
		this.theme = theme;
		this.questions = questions;
		this.options = options;
		this.done = done;
		this.states = questions.map(() => {
			const editor = new Editor(tui, getEditorTheme(), { paddingX: 0, autocompleteMaxVisible: 6 });
			if (options.autocompleteProvider) editor.setAutocompleteProvider(options.autocompleteProvider);
			// Enter is handled by the dialog; the editor only edits.
			editor.disableSubmit = true;
			return { cursor: 0, selected: new Set<number>(), attachments: [], editor, answered: false };
		});
	}

	/** End the dialog as cancelled, for example when the tool call is aborted. */
	cancel(): void {
		this.finish(null);
	}

	invalidate(): void {
		for (const state of this.states) state.editor.invalidate();
	}

	private get hasReviewTab(): boolean {
		return this.questions.length > 1;
	}

	private get onReviewTab(): boolean {
		return this.hasReviewTab && this.tab === this.questions.length;
	}

	private otherRow(index: number): number {
		return this.questions[index].options.length;
	}

	/** Multi-select questions end with a "Next"/"Submit" row after "Type something". */
	private rowCount(index: number): number {
		return this.otherRow(index) + (this.questions[index].multiSelect ? 2 : 1);
	}

	private isEditing(): boolean {
		return !this.onReviewTab && this.states[this.tab].cursor === this.otherRow(this.tab);
	}

	private refresh(): void {
		this.tui.requestRender();
	}

	private finish(result: QuestionDialogResult): void {
		if (this.finished) return;
		this.finished = true;
		this.done(result);
	}

	private customText(index: number): string {
		const editor = this.states[index].editor;
		return editor.getExpandedText().trim();
	}

	private hasAnswer(index: number): boolean {
		const state = this.states[index];
		return state.selected.size > 0 || this.customText(index).length > 0 || state.attachments.length > 0;
	}

	private switchTab(delta: number): void {
		const count = this.questions.length + (this.hasReviewTab ? 1 : 0);
		if (count <= 1) return;
		this.tab = (this.tab + delta + count) % count;
		this.status = undefined;
		this.refresh();
	}

	/** Mark the current question answered and move to the next unanswered one, the review tab, or finish. */
	private advance(): void {
		this.states[this.tab].answered = true;
		this.status = undefined;
		if (!this.hasReviewTab) {
			void this.submit();
			return;
		}
		const next = this.states.findIndex((state, index) => index > this.tab && !state.answered);
		this.tab = next === -1 ? this.questions.length : next;
		this.reviewCursor = 0;
		this.refresh();
	}

	private async submit(): Promise<void> {
		const answers: QuestionAnswer[] = [];
		for (let index = 0; index < this.questions.length; index++) {
			const state = this.states[index];
			const custom = this.customText(index);
			const mentioned = await attachmentsFromMentions(custom, this.options.cwd);
			const attachments = [...state.attachments];
			for (const attachment of mentioned) {
				if (!attachments.some((existing) => existing.path === attachment.path)) attachments.push(attachment);
			}
			answers.push({
				selected: this.questions[index].options
					.filter((_option, optionIndex) => state.selected.has(optionIndex))
					.map((option) => option.label),
				...(custom && { custom }),
				attachments,
			});
		}
		this.finish({ answers });
	}

	private addAttachments(attachments: QuestionAttachment[]): void {
		const state = this.states[this.tab];
		for (const attachment of attachments) {
			if (!state.attachments.some((existing) => existing.path === attachment.path))
				state.attachments.push(attachment);
		}
		this.status = `Attached ${attachments.map(attachmentLabel).join(", ")}`;
		this.refresh();
	}

	private focusEditor(): void {
		this.states[this.tab].cursor = this.otherRow(this.tab);
	}

	private async handlePastedText(text: string): Promise<void> {
		const attachments = await attachmentsFromPastedText(text, this.options.cwd);
		if (this.finished) return;
		if (attachments) {
			this.addAttachments(attachments);
			return;
		}
		this.focusEditor();
		this.states[this.tab].editor.handleInput(`${PASTE_START}${text}${PASTE_END}`);
		this.refresh();
	}

	private async pasteFromClipboard(): Promise<void> {
		if (!this.options.readClipboard) return;
		try {
			const paste = await this.options.readClipboard();
			if (this.finished || !paste) return;
			if ("attachments" in paste) {
				this.addAttachments(paste.attachments);
			} else {
				await this.handlePastedText(paste.text);
			}
		} catch (error) {
			this.options.onError?.(`Paste failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private activateRow(row: number): void {
		const question = this.questions[this.tab];
		const state = this.states[this.tab];
		if (row < question.options.length) {
			if (question.multiSelect) {
				if (state.selected.has(row)) state.selected.delete(row);
				else state.selected.add(row);
				this.refresh();
				return;
			}
			state.selected = new Set([row]);
			this.advance();
			return;
		}
		if (row === this.otherRow(this.tab)) {
			if (question.multiSelect) {
				state.cursor = row + 1;
				this.refresh();
				return;
			}
			if (this.customText(this.tab) || state.attachments.length > 0) {
				// A written answer replaces the option choice of a single-choice question.
				state.selected.clear();
				this.advance();
			} else {
				this.status = "Type an answer, or pick an option";
				this.refresh();
			}
			return;
		}
		// The "Next"/"Submit" row of a multi-select question.
		if (!this.hasAnswer(this.tab)) {
			this.status = "Select at least one option or type an answer";
			this.refresh();
			return;
		}
		this.advance();
	}

	handleInput(data: string): void {
		if (this.finished) return;
		const kb = getKeybindings();

		if (data.startsWith(PASTE_START) && data.endsWith(PASTE_END) && !this.onReviewTab) {
			void this.handlePastedText(data.slice(PASTE_START.length, -PASTE_END.length));
			return;
		}
		if (kb.matches(data, "app.clipboard.pasteImage") && !this.onReviewTab) {
			void this.pasteFromClipboard();
			return;
		}

		if (this.onReviewTab) {
			this.handleReviewInput(data);
			return;
		}

		const question = this.questions[this.tab];
		const state = this.states[this.tab];
		const editing = this.isEditing();
		const autocompleteOpen = editing && state.editor.isShowingAutocomplete();

		if (autocompleteOpen) {
			state.editor.handleInput(data);
			this.refresh();
			return;
		}
		if (kb.matches(data, "tui.select.cancel")) {
			// Leave a written answer without losing it; cancel from the option list.
			if (editing && this.customText(this.tab)) {
				state.cursor = 0;
				this.refresh();
				return;
			}
			this.finish(null);
			return;
		}
		if (kb.matches(data, "tui.input.tab")) {
			this.switchTab(1);
			return;
		}
		if (kb.matches(data, "tui.select.up")) {
			state.cursor = (state.cursor - 1 + this.rowCount(this.tab)) % this.rowCount(this.tab);
			this.refresh();
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			state.cursor = (state.cursor + 1) % this.rowCount(this.tab);
			this.refresh();
			return;
		}
		if (kb.matches(data, "tui.select.confirm")) {
			this.activateRow(state.cursor);
			return;
		}

		if (editing) {
			state.editor.handleInput(data);
			this.status = undefined;
			this.refresh();
			return;
		}

		if (kb.matches(data, "tui.editor.cursorLeft")) {
			this.switchTab(-1);
			return;
		}
		if (kb.matches(data, "tui.editor.cursorRight")) {
			this.switchTab(1);
			return;
		}
		if (kb.matches(data, "tui.editor.deleteCharBackward")) {
			if (state.attachments.pop()) {
				this.status = "Removed the last attachment";
				this.refresh();
			}
			return;
		}
		if (data === " " && question.multiSelect && state.cursor < question.options.length) {
			this.activateRow(state.cursor);
			return;
		}
		const digit = /^[1-9]$/.test(data) ? Number(data) - 1 : -1;
		if (digit >= 0 && digit <= this.otherRow(this.tab)) {
			state.cursor = digit;
			this.activateRow(digit);
			return;
		}
		// Typing anywhere starts a written answer.
		if (data.length === 1 && data >= " " && data !== "\x7f") {
			this.focusEditor();
			state.editor.handleInput(data);
			this.refresh();
		}
	}

	private handleReviewInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.cancel")) {
			this.finish(null);
		} else if (kb.matches(data, "tui.input.tab") || kb.matches(data, "tui.editor.cursorRight")) {
			this.switchTab(1);
		} else if (kb.matches(data, "tui.editor.cursorLeft")) {
			this.switchTab(-1);
		} else if (kb.matches(data, "tui.select.up") || kb.matches(data, "tui.select.down")) {
			this.reviewCursor = this.reviewCursor === 0 ? 1 : 0;
			this.refresh();
		} else if (kb.matches(data, "tui.select.confirm")) {
			if (this.reviewCursor === 0) void this.submit();
			else this.finish(null);
		}
	}

	// ------------------------------------------------------------------------
	// Rendering
	// ------------------------------------------------------------------------

	render(width: number): string[] {
		const w = Math.max(20, width);
		const t = this.theme;
		const lines: string[] = [];
		const push = (text: string, indent = 1) => {
			const pad = " ".repeat(indent);
			for (const line of wrapTextWithAnsi(text, Math.max(1, w - indent))) lines.push(pad + line);
		};

		lines.push(t.fg("borderAccent", "─".repeat(w)));
		if (this.hasReviewTab) {
			lines.push(truncateToWidth(` ${this.renderTabs()}`, w));
		}
		lines.push("");

		if (this.onReviewTab) {
			this.renderReview(push);
		} else {
			this.renderQuestion(w, lines, push);
		}

		if (this.status) {
			lines.push("");
			push(t.fg("warning", this.status));
		}
		lines.push("");
		push(this.renderHints());
		lines.push(t.fg("borderAccent", "─".repeat(w)));
		return lines;
	}

	private renderTabs(): string {
		const t = this.theme;
		const tabs = this.questions.map((question, index) => {
			const name = question.header || `Q${index + 1}`;
			const mark = this.states[index].answered ? t.fg("success", "✓ ") : t.fg("dim", "○ ");
			const label = ` ${mark}${name} `;
			return index === this.tab ? t.bg("selectedBg", t.bold(label)) : t.fg("muted", label);
		});
		const submit = " Submit ";
		tabs.push(this.onReviewTab ? t.bg("selectedBg", t.bold(submit)) : t.fg("muted", submit));
		return tabs.join(t.fg("dim", "│"));
	}

	private renderQuestion(w: number, lines: string[], push: (text: string, indent?: number) => void): void {
		const t = this.theme;
		const question = this.questions[this.tab];
		const state = this.states[this.tab];
		push(t.bold(t.fg("text", question.question)));
		if (question.multiSelect) push(t.fg("dim", "Select all that apply"));
		lines.push("");

		const pushRow = (row: number, label: string, color: "accent" | "text" | "muted") => {
			const focused = state.cursor === row;
			const pointer = focused ? t.fg("accent", "› ") : "  ";
			const prefixWidth = 3;
			const wrapped = wrapTextWithAnsi(t.fg(focused ? "accent" : color, label), Math.max(1, w - prefixWidth - 1));
			wrapped.forEach((line, i) => {
				lines.push(`${i === 0 ? ` ${pointer}` : "   "}${line}`);
			});
		};

		question.options.forEach((option, index) => {
			const checked = state.selected.has(index);
			const box = question.multiSelect ? (checked ? "[✓] " : "[ ] ") : "";
			const number = `${index + 1}. `;
			const label = `${number}${box}${option.label}`;
			pushRow(index, label, checked ? "accent" : "text");
			if (option.description) {
				const indent = 3 + visibleWidth(number) + visibleWidth(box);
				for (const line of wrapTextWithAnsi(t.fg("muted", option.description), Math.max(1, w - indent - 1))) {
					lines.push(" ".repeat(indent) + line);
				}
			}
		});

		const otherRow = this.otherRow(this.tab);
		const written = this.customText(this.tab);
		const otherNumber = `${otherRow + 1}. `;
		if (state.cursor === otherRow) {
			pushRow(otherRow, `${otherNumber}Type something…`, "text");
			const indent = 3 + visibleWidth(otherNumber);
			for (const line of state.editor.render(Math.max(10, w - indent - 1))) {
				lines.push(" ".repeat(indent) + line);
			}
		} else if (written) {
			pushRow(
				otherRow,
				`${otherNumber}${t.italic(truncateToWidth(written.replace(/\s+/g, " "), w - 10))}`,
				"accent",
			);
		} else {
			pushRow(otherRow, `${otherNumber}Type something…`, "muted");
		}

		if (question.multiSelect) {
			lines.push("");
			const isLast = !this.hasReviewTab;
			pushRow(otherRow + 1, isLast ? "Submit" : "Next →", "text");
		}

		const focusedOption = question.options[state.cursor];
		if (focusedOption?.preview) {
			lines.push("");
			lines.push(...this.renderPreview(focusedOption.preview, w));
		}

		if (state.attachments.length > 0) {
			lines.push("");
			push(t.fg("muted", "Attached:"));
			for (const attachment of state.attachments) {
				push(`${t.fg("success", "+")} ${t.fg("text", attachmentLabel(attachment))}`, 3);
			}
		}
	}

	private renderPreview(preview: string, w: number): string[] {
		const t = this.theme;
		const inner = Math.max(10, w - 7);
		const source = preview.replace(/\t/g, "  ").split("\n");
		const shown = source.slice(0, MAX_PREVIEW_LINES);
		const lines = [`   ${t.fg("borderMuted", `┌${"─".repeat(inner + 2)}┐`)}`];
		for (const line of shown) {
			const cut = truncateToWidth(line, inner);
			const pad = " ".repeat(Math.max(0, inner - visibleWidth(cut)));
			lines.push(`   ${t.fg("borderMuted", "│")} ${t.fg("mdCodeBlock", cut)}${pad} ${t.fg("borderMuted", "│")}`);
		}
		if (source.length > shown.length) {
			const more = truncateToWidth(`… ${source.length - shown.length} more lines`, inner);
			const pad = " ".repeat(Math.max(0, inner - visibleWidth(more)));
			lines.push(`   ${t.fg("borderMuted", "│")} ${t.fg("dim", more)}${pad} ${t.fg("borderMuted", "│")}`);
		}
		lines.push(`   ${t.fg("borderMuted", `└${"─".repeat(inner + 2)}┘`)}`);
		return lines;
	}

	private renderReview(push: (text: string, indent?: number) => void): void {
		const t = this.theme;
		push(t.bold(t.fg("text", "Review your answers")));
		push("");
		this.questions.forEach((question, index) => {
			const state = this.states[index];
			push(`${t.fg("muted", `${question.header || `Q${index + 1}`}:`)} ${t.fg("text", question.question)}`);
			const parts = question.options.filter((_o, i) => state.selected.has(i)).map((option) => option.label);
			const written = this.customText(index);
			if (written) parts.push(`“${written.replace(/\s+/g, " ")}”`);
			if (state.attachments.length > 0) parts.push(`${state.attachments.length} attachment(s)`);
			push(parts.length > 0 ? t.fg("accent", `→ ${parts.join(", ")}`) : t.fg("warning", "→ (no answer)"), 3);
		});
		push("");
		const rows = ["Submit answers", "Cancel"];
		rows.forEach((row, index) => {
			const focused = this.reviewCursor === index;
			push(`${focused ? t.fg("accent", "› ") : "  "}${t.fg(focused ? "accent" : "text", row)}`);
		});
	}

	private renderHints(): string {
		const sep = this.theme.fg("dim", " · ");
		if (this.onReviewTab) {
			return [
				rawKeyHint("↑↓", "move"),
				keyHint("tui.select.confirm", "choose"),
				rawKeyHint("←→", "questions"),
				keyHint("tui.select.cancel", "cancel"),
			].join(sep);
		}
		const question = this.questions[this.tab];
		const hints = [rawKeyHint("↑↓", "move")];
		if (this.isEditing()) {
			hints.push(rawKeyHint("@", "file"), keyHint("tui.select.confirm", question.multiSelect ? "next" : "send"));
		} else {
			hints.push(
				keyHint("tui.select.confirm", question.multiSelect ? "toggle" : "select"),
				rawKeyHint("1-9", "pick"),
			);
		}
		hints.push(keyHint("app.clipboard.pasteImage", "attach"));
		if (this.hasReviewTab) hints.push(keyHint("tui.input.tab", "next question"));
		hints.push(keyHint("tui.select.cancel", "cancel"));
		return hints.join(sep);
	}
}
