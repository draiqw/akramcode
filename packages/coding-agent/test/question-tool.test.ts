import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getKeybindings, setKeybindings, stripTerminalSequences, TuiMainScreen } from "@akramcode/tui";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import type { ExtensionToolContext } from "../src/core/extensions/types.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { MAX_ATTACHMENT_TEXT_BYTES } from "../src/extensions/question/attachments.ts";
import {
	type ClipboardPaste,
	QuestionDialog,
	type QuestionDialogResult,
	type QuestionSpec,
} from "../src/extensions/question/dialog.ts";
import { createQuestionToolDefinition, formatAnswers } from "../src/extensions/question/index.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

const ENTER = "\r";
const DOWN = "\x1b[B";
const UP = "\x1b[A";
const ESC = "\x1b";
const TAB = "\t";
const BACKSPACE = "\x7f";
const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;

// 1x1 transparent PNG.
const PNG_BYTES = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	"base64",
);

const previousKeybindings = getKeybindings();
beforeAll(() => {
	initTheme("dark");
	setKeybindings(new KeybindingsManager());
});
afterAll(() => setKeybindings(previousKeybindings));

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "akramcode-question-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Harness {
	dialog: QuestionDialog;
	result: Promise<QuestionDialogResult>;
	send(...keys: string[]): Promise<void>;
	screen(width?: number): string;
}

function openDialog(questions: QuestionSpec[], readClipboard?: () => Promise<ClipboardPaste>): Harness {
	const tui = new TuiMainScreen(new VirtualTerminal());
	let resolve!: (result: QuestionDialogResult) => void;
	const result = new Promise<QuestionDialogResult>((r) => {
		resolve = r;
	});
	const dialog = new QuestionDialog(tui, theme, questions, { cwd: dir, readClipboard }, resolve);
	return {
		dialog,
		result,
		async send(...keys) {
			for (const key of keys) {
				dialog.handleInput(key);
				// Pastes and submits resolve attachments asynchronously.
				await new Promise((r) => setTimeout(r, 5));
			}
		},
		screen: (width = 80) => stripTerminalSequences(dialog.render(width).join("\n")),
	};
}

const db: QuestionSpec = {
	question: "Which database?",
	header: "DB",
	options: [
		{ label: "Postgres (Recommended)", description: "Relational, mature", preview: "DATABASE_URL=postgres://" },
		{ label: "SQLite" },
	],
};
const features: QuestionSpec = {
	question: "Which features?",
	header: "Features",
	options: [{ label: "Auth" }, { label: "Billing" }, { label: "Search" }],
	multiSelect: true,
};

describe("question dialog", () => {
	it("returns the chosen option of a single question on Enter", async () => {
		const h = openDialog([db]);
		const screen = h.screen();
		expect(screen).toContain("Which database?");
		expect(screen).toContain("› 1. Postgres (Recommended)");
		expect(screen).toContain("Relational, mature");
		// The focused option's preview is boxed below the list.
		expect(screen).toContain("│ DATABASE_URL=postgres://");
		await h.send(DOWN, ENTER);
		expect(await h.result).toEqual({ answers: [{ selected: ["SQLite"], attachments: [] }] });
	});

	it("picks with number keys and cancels with Escape", async () => {
		const picked = openDialog([db]);
		await picked.send("2");
		expect((await picked.result)?.answers[0].selected).toEqual(["SQLite"]);

		const cancelled = openDialog([db]);
		await cancelled.send(ESC);
		expect(await cancelled.result).toBeNull();
	});

	it("toggles several options of a multi-select question and submits from the last row", async () => {
		const h = openDialog([features]);
		await h.send(ENTER, DOWN, DOWN, " ");
		expect(h.screen()).toContain("[✓] Auth");
		expect(h.screen()).toContain("[ ] Billing");
		expect(h.screen()).toContain("[✓] Search");
		// Up from the first row wraps to the Submit row.
		await h.send(UP, UP, UP, ENTER);
		expect(await h.result).toEqual({ answers: [{ selected: ["Auth", "Search"], attachments: [] }] });
	});

	it("does not submit an empty multi-select answer", async () => {
		const h = openDialog([features]);
		await h.send(UP, ENTER);
		expect(h.screen()).toContain("Select at least one option or type an answer");
		await h.send("1", UP, ENTER);
		expect((await h.result)?.answers[0].selected).toEqual(["Auth"]);
	});

	it("takes a typed answer, keeps it on Escape, and attaches @-mentioned files", async () => {
		writeFileSync(join(dir, "notes.md"), "use pg");
		const h = openDialog([db]);
		// Typing on an option row starts the written answer.
		await h.send(..."Neither, see @notes.md".split(""));
		expect(h.screen()).toContain("3. Type something…");
		await h.send(ESC);
		expect(h.screen()).toContain("3. Neither, see @notes.md");
		await h.send(DOWN, DOWN, ENTER);
		const result = await h.result;
		expect(result?.answers[0]).toMatchObject({ selected: [], custom: "Neither, see @notes.md" });
		expect(result?.answers[0].attachments).toEqual([{ path: join(dir, "notes.md"), kind: "file", size: 6 }]);
	});

	it("attaches dropped file paths and clipboard images, and removes them with Backspace", async () => {
		writeFileSync(join(dir, "shot.png"), PNG_BYTES);
		writeFileSync(join(dir, "a.txt"), "a");
		const h = openDialog([db], async () => ({
			attachments: [{ path: join(dir, "shot.png"), kind: "image", size: PNG_BYTES.length }],
		}));
		await h.send(paste(`'${join(dir, "a.txt")}'`), "\x16");
		const screen = h.screen();
		expect(screen).toContain("Attached:");
		expect(screen).toContain("+ a.txt (file, 1 B)");
		expect(screen).toContain("+ shot.png (image, ");
		await h.send(BACKSPACE);
		expect(h.screen()).not.toContain("shot.png");
		// Pasted text that is not a path goes into the answer.
		await h.send(paste("plain words"));
		expect(h.screen()).toContain("plain words");
		await h.send(UP, ENTER);
		const result = await h.result;
		expect(result?.answers[0].selected).toEqual(["SQLite"]);
		expect(result?.answers[0].custom).toBe("plain words");
		expect(result?.answers[0].attachments.map((a) => a.kind)).toEqual(["file"]);
	});

	it("walks several questions through tabs to a review step", async () => {
		const h = openDialog([db, features]);
		expect(h.screen()).toContain("○ DB");
		await h.send(ENTER);
		// Answering moves to the next unanswered question.
		expect(h.screen()).toContain("Which features?");
		expect(h.screen()).toContain("✓ DB");
		await h.send("2", DOWN, DOWN, DOWN, ENTER);
		const review = h.screen();
		expect(review).toContain("Review your answers");
		expect(review).toContain("→ Postgres (Recommended)");
		expect(review).toContain("→ Billing");
		// Tab cycles back to the first question and keeps its answer.
		await h.send(TAB);
		expect(h.screen()).toContain("Which database?");
		await h.send(TAB, TAB, ENTER);
		expect(await h.result).toEqual({
			answers: [
				{ selected: ["Postgres (Recommended)"], attachments: [] },
				{ selected: ["Billing"], attachments: [] },
			],
		});
	});

	it("ends as cancelled when cancel() is called, once", async () => {
		const h = openDialog([db]);
		h.dialog.cancel();
		h.dialog.cancel();
		await h.send(ENTER);
		expect(await h.result).toBeNull();
	});

	it("renders within narrow widths", () => {
		const h = openDialog([db, features]);
		for (const line of h.dialog.render(30)) {
			expect(stripTerminalSequences(line).length).toBeLessThanOrEqual(30);
		}
	});
});

describe("question tool", () => {
	const tool = createQuestionToolDefinition();

	function context(overrides: Partial<ExtensionToolContext>): ExtensionToolContext {
		return { hasUI: true, mode: "rpc", cwd: dir, model: undefined, ...overrides } as ExtensionToolContext;
	}

	it("normalizes a single question with string options", () => {
		expect(tool.prepareArguments?.({ question: "Q?", options: ["A", { label: "B" }] })).toEqual({
			questions: [{ question: "Q?", options: [{ label: "A" }, { label: "B" }] }],
		});
	});

	it("formats answers for the model", () => {
		const text = formatAnswers(
			[db, features],
			[
				{ selected: ["SQLite"], custom: "small app", attachments: [] },
				{ selected: [], attachments: [] },
			],
		);
		expect(text).toBe(
			[
				"The user answered:",
				"1. [DB] Which database?",
				"   Selected: SQLite",
				"   Note: small app",
				"2. [Features] Which features?",
				"   (no answer)",
			].join("\n"),
		);
	});

	it("tells the model to decide alone when there is no user", async () => {
		const result = await tool.execute("id", { questions: [db] }, undefined, undefined, context({ hasUI: false }));
		expect(result.details).toMatchObject({ unavailable: true });
		expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("No user is available") });
	});

	it("asks RPC clients with select and input dialogs", async () => {
		const prompts: string[] = [];
		const ui = {
			select: async (title: string, options: string[]) => {
				prompts.push(title);
				return options[options.length - 1];
			},
			input: async (title: string) => {
				prompts.push(title);
				return prompts.length === 2 ? "MySQL" : "1, 3";
			},
		};
		const result = await tool.execute(
			"id",
			{ questions: [db, features] },
			undefined,
			undefined,
			context({ ui: ui as unknown as ExtensionToolContext["ui"] }),
		);
		expect(prompts[0]).toBe("Which database?");
		expect(prompts[2]).toContain("2. Billing");
		expect(result.details?.answers).toEqual([
			{ selected: [], custom: "MySQL", attachments: [] },
			{ selected: ["Auth", "Search"], attachments: [] },
		]);
	});

	it("returns attached text files and images in the result", async () => {
		writeFileSync(join(dir, "big.txt"), "x".repeat(MAX_ATTACHMENT_TEXT_BYTES + 10));
		writeFileSync(join(dir, "shot.png"), PNG_BYTES);
		const ui = {
			custom: async () => ({
				answers: [
					{
						selected: ["SQLite"],
						attachments: [
							{ path: join(dir, "big.txt"), kind: "file", size: MAX_ATTACHMENT_TEXT_BYTES + 10 },
							{ path: join(dir, "shot.png"), kind: "image", size: PNG_BYTES.length },
						],
					},
				],
			}),
		};
		const result = await tool.execute(
			"id",
			{ questions: [db] },
			undefined,
			undefined,
			context({ mode: "tui", ui: ui as unknown as ExtensionToolContext["ui"] }),
		);
		const text = result.content[0].type === "text" ? result.content[0].text : "";
		expect(text).toContain("Selected: SQLite");
		expect(text).toContain(`<file name="${join(dir, "big.txt")}">`);
		expect(text).toContain("[Truncated at 64 KB");
		expect(text).toContain("[Image 1 of this answer, attached below as image/png.]");
		expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
	});

	it("reports a cancelled dialog", async () => {
		const ui = { custom: async () => null };
		const result = await tool.execute(
			"id",
			{ questions: [db] },
			undefined,
			undefined,
			context({ mode: "tui", ui: ui as unknown as ExtensionToolContext["ui"] }),
		);
		expect(result.details).toMatchObject({ cancelled: true });
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining("dismissed") });
	});
});
