/**
 * The `question` tool: the model asks the user one to four multiple-choice questions and gets the
 * answers back, including text the user wrote and files or images they attached.
 *
 * The TUI shows {@link QuestionDialog}. RPC clients get a select/input dialog per question. Print
 * and JSON modes have no user, so the tool tells the model to decide on its own.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImageContent, TextContent } from "@akramcode/ai";
import { CombinedAutocompleteProvider, Container, Text } from "@akramcode/tui";
import { type Static, Type } from "typebox";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "../../core/extensions/types.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { readClipboardFilePaths, readClipboardText } from "../../utils/clipboard.ts";
import { extensionForImageMimeType, readClipboardImage } from "../../utils/clipboard-image.ts";
import { getToolPath } from "../../utils/tools-manager.ts";
import { attachmentLabel, describeAttachment, loadAttachments, type QuestionAttachment } from "./attachments.ts";
import {
	type ClipboardPaste,
	type QuestionAnswer,
	QuestionDialog,
	type QuestionDialogResult,
	type QuestionSpec,
} from "./dialog.ts";

const OptionSchema = Type.Object({
	label: Type.String({ description: "Short choice text, 1-5 words." }),
	description: Type.Optional(Type.String({ description: "What the option means or implies." })),
	preview: Type.Optional(
		Type.String({
			description:
				"Optional monospace preview shown while the option is focused: a code snippet, layout mockup, or config to compare.",
		}),
	),
});

const QuestionSchema = Type.Object({
	question: Type.String({ description: "The full question, ending with a question mark." }),
	header: Type.Optional(
		Type.String({ description: "Very short tab label, at most 12 characters, e.g. 'Auth method'." }),
	),
	options: Type.Array(OptionSchema, {
		minItems: 1,
		maxItems: 8,
		description:
			"Distinct choices. Do not add an 'Other' option: the user can always type their own answer and attach files.",
	}),
	multiSelect: Type.Optional(Type.Boolean({ description: "Allow choosing several options. Default false." })),
});

const questionSchema = Type.Object({
	questions: Type.Array(QuestionSchema, { minItems: 1, maxItems: 4, description: "One to four questions." }),
});

export type QuestionToolInput = Static<typeof questionSchema>;

export interface QuestionToolDetails {
	questions: QuestionSpec[];
	answers?: QuestionAnswer[];
	/** The user dismissed the dialog. */
	cancelled?: boolean;
	/** No user could be asked (print or JSON mode). */
	unavailable?: boolean;
}

const NO_USER_TEXT =
	"No user is available to answer (non-interactive mode). Make the most reasonable choice yourself, state the assumption, and continue.";
const CANCELLED_TEXT =
	"The user dismissed the question without answering. Do not assume an answer: continue with what does not depend on it, or ask in plain text.";

/** Accept the single-question shape and string options that models sometimes send. */
function prepareQuestionArguments(args: unknown): QuestionToolInput {
	if (!args || typeof args !== "object") return args as QuestionToolInput;
	const raw = args as Record<string, unknown>;
	const questions = Array.isArray(raw.questions)
		? raw.questions
		: typeof raw.question === "string"
			? [raw]
			: undefined;
	if (!questions) return args as QuestionToolInput;
	return {
		questions: questions.map((question) => {
			if (!question || typeof question !== "object") return question;
			const q = question as Record<string, unknown>;
			const options = Array.isArray(q.options)
				? q.options.map((option) => (typeof option === "string" ? { label: option } : option))
				: q.options;
			return { ...q, options };
		}),
	} as QuestionToolInput;
}

/** The answers as text for the model. */
export function formatAnswers(questions: readonly QuestionSpec[], answers: readonly QuestionAnswer[]): string {
	const lines = ["The user answered:"];
	questions.forEach((question, index) => {
		const answer = answers[index];
		const header = question.header ? `[${question.header}] ` : "";
		lines.push(`${index + 1}. ${header}${question.question}`);
		if (!answer || (answer.selected.length === 0 && !answer.custom && answer.attachments.length === 0)) {
			lines.push("   (no answer)");
			return;
		}
		if (answer.selected.length > 0) lines.push(`   Selected: ${answer.selected.join(", ")}`);
		if (answer.custom) {
			const label = answer.selected.length > 0 ? "Note" : "Answer";
			lines.push(`   ${label}: ${answer.custom.replace(/\n/g, "\n   ")}`);
		}
		if (answer.attachments.length > 0) {
			lines.push(`   Attached: ${answer.attachments.map((attachment) => attachment.path).join(", ")}`);
		}
	});
	return lines.join("\n");
}

/** Clipboard contents for the paste key: copied files, an image saved to a temp file, or text. */
async function readClipboardForDialog(cwd: string): Promise<ClipboardPaste> {
	const filePaths = await readClipboardFilePaths();
	if (filePaths) {
		const attachments: QuestionAttachment[] = [];
		for (const filePath of filePaths) {
			const attachment = await describeAttachment(filePath, cwd);
			if (attachment) attachments.push(attachment);
		}
		if (attachments.length > 0) return { attachments };
	}
	const image = await readClipboardImage();
	if (image) {
		const dir = mkdtempSync(join(tmpdir(), "akramcode-question-"));
		const path = join(dir, `clipboard.${extensionForImageMimeType(image.mimeType) ?? "png"}`);
		writeFileSync(path, Buffer.from(image.bytes));
		return { attachments: [{ path, kind: "image", size: image.bytes.length }] };
	}
	const text = await readClipboardText();
	return text ? { text } : null;
}

async function askInTui(
	ctx: ExtensionContext,
	questions: QuestionSpec[],
	signal: AbortSignal | undefined,
): Promise<QuestionDialogResult> {
	return ctx.ui.custom<QuestionDialogResult>((tui, theme, _keybindings, done) => {
		const dialog = new QuestionDialog(
			tui,
			theme,
			questions,
			{
				cwd: ctx.cwd,
				autocompleteProvider: new CombinedAutocompleteProvider([], ctx.cwd, getToolPath("fd")),
				readClipboard: () => readClipboardForDialog(ctx.cwd),
				onError: (message) => ctx.ui.notify(message, "error"),
			},
			done,
		);
		signal?.addEventListener("abort", () => dialog.cancel(), { once: true });
		return dialog;
	});
}

/** RPC clients have no custom components: one select (or input for multiple choice) per question. */
async function askWithDialogs(ctx: ExtensionContext, questions: QuestionSpec[]): Promise<QuestionDialogResult> {
	const answers: QuestionAnswer[] = [];
	for (const question of questions) {
		const numbered = question.options.map((option, index) => `${index + 1}. ${option.label}`);
		if (question.multiSelect) {
			const reply = await ctx.ui.input(
				`${question.question}\n${numbered.join("\n")}\nEnter option numbers separated by commas, or your own answer.`,
			);
			if (reply === undefined) return null;
			const tokens = reply
				.split(",")
				.map((token) => token.trim())
				.filter(Boolean);
			const indexes = tokens.map((token) => Number(token) - 1);
			const allNumbers =
				tokens.length > 0 && indexes.every((index) => Number.isInteger(index) && question.options[index]);
			answers.push(
				allNumbers
					? {
							selected: [...new Set(indexes)].sort().map((index) => question.options[index].label),
							attachments: [],
						}
					: { selected: [], custom: reply.trim(), attachments: [] },
			);
			continue;
		}
		const other = `${question.options.length + 1}. Type something…`;
		const choice = await ctx.ui.select(question.question, [...numbered, other]);
		if (choice === undefined) return null;
		if (choice === other) {
			const reply = await ctx.ui.input(question.question, "Your answer");
			if (reply === undefined) return null;
			answers.push({ selected: [], custom: reply.trim(), attachments: [] });
			continue;
		}
		const index = numbered.indexOf(choice);
		answers.push({ selected: index >= 0 ? [question.options[index].label] : [choice], attachments: [] });
	}
	return { answers };
}

/**
 * Ask `questions` with the dialog the mode supports: the question dialog in the TUI, one
 * select or input per question in RPC. Resolves to `null` when the user cancels. Needs `ctx.hasUI`.
 */
export function askQuestions(
	ctx: ExtensionContext,
	questions: QuestionSpec[],
	signal?: AbortSignal,
): Promise<QuestionDialogResult> {
	return ctx.mode === "tui" ? askInTui(ctx, questions, signal) : askWithDialogs(ctx, questions);
}

function answerSummary(answer: QuestionAnswer | undefined): string {
	if (!answer) return "(no answer)";
	const parts = [...answer.selected];
	if (answer.custom) parts.push(`“${answer.custom.replace(/\s+/g, " ")}”`);
	if (answer.attachments.length > 0) parts.push(answer.attachments.map(attachmentLabel).join(", "));
	return parts.length > 0 ? parts.join(", ") : "(no answer)";
}

function renderQuestionCall(args: QuestionToolInput, theme: Theme): Text {
	const questions = Array.isArray(args?.questions) ? args.questions : [];
	let text = theme.fg("toolTitle", theme.bold("question"));
	if (questions.length === 1) {
		text += ` ${theme.fg("muted", questions[0]?.question ?? "")}`;
	} else if (questions.length > 1) {
		text += ` ${theme.fg("muted", `${questions.length} questions`)}`;
		for (const question of questions) {
			text += `\n  ${theme.fg("dim", "·")} ${theme.fg("muted", question?.question ?? "")}`;
		}
	}
	return new Text(text, 0, 0);
}

function renderQuestionResult(details: QuestionToolDetails | undefined, fallback: string, theme: Theme): Container {
	const container = new Container();
	if (!details) {
		container.addChild(new Text(fallback, 0, 0));
		return container;
	}
	if (details.unavailable) {
		container.addChild(new Text(theme.fg("warning", "No user to ask in this mode"), 0, 0));
		return container;
	}
	if (details.cancelled || !details.answers) {
		container.addChild(new Text(theme.fg("warning", "Cancelled"), 0, 0));
		return container;
	}
	const lines = details.questions.map((question, index) => {
		const label = question.header || (details.questions.length > 1 ? `Q${index + 1}` : "");
		const prefix = label ? theme.fg("muted", `${label}: `) : "";
		return `${theme.fg("success", "✓ ")}${prefix}${theme.fg("accent", answerSummary(details.answers?.[index]))}`;
	});
	container.addChild(new Text(lines.join("\n"), 0, 0));
	return container;
}

export function createQuestionToolDefinition(): ToolDefinition<typeof questionSchema, QuestionToolDetails> {
	return {
		name: "question",
		label: "Question",
		description:
			"Ask the user one to four multiple-choice questions and wait for the answers. The user can pick options (or several, with multiSelect), type their own answer, and attach files or images. Use it only when you are blocked on a decision that is the user's to make and that you cannot resolve from the request, the code, or a sensible default. Put the recommended option first and add ' (Recommended)' to its label.",
		promptSnippet: "Ask the user multiple-choice questions when blocked on a decision only they can make",
		promptGuidelines: [
			"Use the question tool only for decisions that are genuinely the user's; pick conventional defaults yourself and verify facts in the code instead of asking.",
		],
		parameters: questionSchema,
		prepareArguments: prepareQuestionArguments,
		executionMode: "sequential",
		annotations: { readOnlyHint: true },

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const questions: QuestionSpec[] = params.questions.map((question) => ({
				question: question.question,
				...(question.header && { header: question.header }),
				options: question.options.map((option) => ({
					label: option.label,
					...(option.description && { description: option.description }),
					...(option.preview && { preview: option.preview }),
				})),
				...(question.multiSelect && { multiSelect: true }),
			}));

			if (!ctx.hasUI) {
				return { content: [{ type: "text", text: NO_USER_TEXT }], details: { questions, unavailable: true } };
			}

			const result = await askQuestions(ctx, questions, signal);
			if (!result) {
				return { content: [{ type: "text", text: CANCELLED_TEXT }], details: { questions, cancelled: true } };
			}

			const attachments = result.answers.flatMap((answer) => answer.attachments);
			const loaded = await loadAttachments(attachments, {
				supportsImages: !ctx.model || ctx.model.input.includes("image"),
				resizeOptions: ctx.model?.inputLimits?.images?.resize,
			});
			const text = loaded.text
				? `${formatAnswers(questions, result.answers)}\n\n${loaded.text}`
				: formatAnswers(questions, result.answers);
			const content: (TextContent | ImageContent)[] = [{ type: "text", text }, ...loaded.images];
			return { content, details: { questions, answers: result.answers } };
		},

		renderCall(args, theme) {
			return renderQuestionCall(args, theme);
		},

		renderResult(result, _options, theme) {
			const first = result.content[0];
			return renderQuestionResult(result.details, first?.type === "text" ? first.text : "", theme);
		},
	};
}

export function createQuestionExtension() {
	return (akramcode: ExtensionAPI) => {
		akramcode.registerTool(createQuestionToolDefinition());
		// Without a UI nobody can answer, so the tool would only cost schema tokens on every request.
		akramcode.on("session_start", (_event, ctx) => {
			if (ctx.hasUI) return;
			akramcode.setActiveTools(akramcode.getActiveTools().filter((name) => name !== "question"));
		});
	};
}

export default createQuestionExtension();
