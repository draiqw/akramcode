import type { ImageContent } from "@akramcode/ai";
import {
	type Component,
	Container,
	getImageDimensions,
	Image,
	Markdown,
	type MarkdownTheme,
	Spacer,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@akramcode/tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/** Local time of day a message was sent, e.g. "19:20". */
export function formatMessageTime(timestamp: number): string {
	const date = new Date(timestamp);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Wrapper around a pasted block in the submitted text, so the transcript can collapse it again. */
export function wrapPastedText(id: number, content: string): string {
	return `<pasted_text id="${id}">\n${content}\n</pasted_text>`;
}

const PASTED_TEXT_PATTERN = /<pasted_text id="(\d+)">\n([\s\S]*?)\n<\/pasted_text>/g;

/** The text with pasted blocks shown as `[Pasted text #1 +40 lines]`, or unwrapped when expanded. */
export function displayPastedText(text: string, expanded: boolean): string {
	return text.replace(PASTED_TEXT_PATTERN, (_match, id: string, content: string) =>
		expanded ? content : `[Pasted text #${id} +${content.split("\n").length} lines]`,
	);
}

/** Message text split around pasted blocks, in order. */
function splitPastedText(text: string): Array<{ text: string } | { id: string; content: string }> {
	const parts: Array<{ text: string } | { id: string; content: string }> = [];
	let position = 0;
	for (const match of text.matchAll(PASTED_TEXT_PATTERN)) {
		if (match.index > position) parts.push({ text: text.slice(position, match.index) });
		parts.push({ id: match[1]!, content: match[2]! });
		position = match.index + match[0].length;
	}
	if (position < text.length) parts.push({ text: text.slice(position) });
	return parts;
}

const ATTACHMENT_MARKER = /\[(?:Image #\d+|Pasted text #\d+(?: \+\d+ lines| \d+ chars)?)\]/g;

/** Color `[Image #N]` and `[Pasted text #N ...]` markers with the accent; `restore` is the ANSI code of the text after. */
export function highlightAttachmentMarkers(line: string, restore: string): string {
	return line.replace(ATTACHMENT_MARKER, (marker) => theme.getFgAnsi("accent") + marker + restore);
}

/** Width of the "HH:MM " prefix that precedes the first line of a message. */
export const TIME_PREFIX_WIDTH = 6;

/**
 * Put a dim "HH:MM" at the start of a message's first line, after `outputPad` columns. The line must start with
 * `textPad` spaces of padding, which the prefix replaces: with `textPad = outputPad + TIME_PREFIX_WIDTH`, continuation
 * lines align with the text; with `textPad = outputPad`, the caller renders the content narrower so the prefix fits.
 * `bg` re-applies the line background.
 */
export function prefixMessageTime(
	lines: string[],
	outputPad: number,
	timestamp: number,
	bg?: (text: string) => string,
	textPad = outputPad + TIME_PREFIX_WIDTH,
): void {
	if (lines.length === 0) return;
	// Leading style codes (e.g. the background) come before the padding.
	const match = new RegExp(`^((?:\\x1b\\[[0-9;]*m)*) {${textPad}}`).exec(lines[0]!);
	if (!match) return;
	const prefix = " ".repeat(outputPad) + theme.fg("dim", formatMessageTime(timestamp).padEnd(TIME_PREFIX_WIDTH));
	lines[0] = (bg ? bg(prefix) : prefix) + match[1] + lines[0]!.slice(match[0].length);
}

/** Widest an attached image is drawn, in cells; the frame spans this width. */
const IMAGE_FRAME_WIDTH = 60;

/** Accent rules around content: the top one carries the label, e.g. `╭─ [Pasted text #1] · 1234 chars ──`. */
function frame(label: string, body: string[], pad: number, frameWidth: number): string[] {
	const indent = " ".repeat(pad);
	const title = truncateToWidth(` ${label} `, frameWidth - 3, "");
	const top = `╭─${title}${"─".repeat(Math.max(0, frameWidth - 2 - visibleWidth(title)))}`;
	const bottom = `╰${"─".repeat(frameWidth - 1)}`;
	return [indent + theme.fg("accent", top), ...body.map((line) => indent + line), indent + theme.fg("accent", bottom)];
}

/** A pasted block shown verbatim inside a frame with its character count. */
class FramedPaste implements Component {
	private readonly content: string;
	private readonly label: string;
	private readonly pad: number;

	constructor(id: string, content: string, pad: number) {
		this.content = content;
		this.label = `[Pasted text #${id}] · ${content.length} chars`;
		this.pad = pad;
	}

	invalidate(): void {}

	render(width: number): string[] {
		// The right margin mirrors the left one, so the frame does not run into the terminal edge.
		const frameWidth = Math.max(4, width - 2 * this.pad);
		const bar = theme.fg("accent", "│ ");
		const body = this.content
			.split("\n")
			.flatMap((line) => wrapTextWithAnsi(line.replace(/\t/g, "    "), Math.max(1, frameWidth - 2)))
			.map((line) => bar + theme.fg("userMessageText", line));
		return frame(this.label, body, this.pad, frameWidth);
	}
}

/**
 * An attached image between two accent rules: the top one names it, e.g. `╭─ [Image #1] · png 1280×720 ──`.
 * The sides stay open because some terminals erase inline images when text is drawn on their rows.
 */
class FramedImage implements Component {
	private readonly image: Image;
	private readonly label: string;
	private readonly pad: number;

	constructor(image: ImageContent, label: string, pad: number) {
		this.image = new Image(
			image.data,
			image.mimeType,
			{ fallbackColor: (s: string) => theme.fg("dim", s) },
			{ maxWidthCells: IMAGE_FRAME_WIDTH },
		);
		const size = getImageDimensions(image.data, image.mimeType);
		const format = image.mimeType.replace(/^image\//, "");
		this.label = [label, size ? `${format} ${size.widthPx}×${size.heightPx}` : format].join(" · ");
		this.pad = pad;
	}

	invalidate(): void {
		this.image.invalidate?.();
	}

	render(width: number): string[] {
		const frameWidth = Math.max(4, Math.min(width - this.pad, IMAGE_FRAME_WIDTH + 2));
		return frame(this.label, this.image.render(Math.max(1, width - this.pad)), this.pad, frameWidth);
	}
}

/**
 * Component that renders a user message on a dark background. The dim send time precedes the first line,
 * and continuation lines align with the text after it.
 */
export class UserMessageComponent extends Container {
	private text: string;
	private markdownTheme: MarkdownTheme;
	private outputPad: number;
	private markdownTransformers: readonly MarkdownTransformer[];
	private timestamp: number | undefined;
	private images: readonly ImageContent[];
	private expanded = false;

	constructor(
		text: string,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		timestamp?: number,
		images: readonly ImageContent[] = [],
	) {
		super();
		this.text = text;
		this.images = images;
		this.markdownTheme = markdownTheme;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;
		this.timestamp = timestamp;
		this.rebuild();
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		this.rebuild();
	}

	private textPad(): number {
		return this.outputPad + (this.timestamp === undefined ? 0 : TIME_PREFIX_WIDTH);
	}

	/** Expanded messages show pasted text in full and the attached images. */
	setExpanded(expanded: boolean): void {
		if (this.expanded === expanded) return;
		this.expanded = expanded;
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		if (!this.expanded) {
			this.addChild(this.createMarkdown(displayPastedText(this.text, false)));
		} else {
			for (const part of splitPastedText(this.text)) {
				if ("content" in part) this.addChild(new FramedPaste(part.id, part.content, this.textPad()));
				else if (part.text.trim()) this.addChild(this.createMarkdown(part.text.trim()));
			}
			// Images follow their markers' order in the text, so each is labeled with its marker.
			const labels = [...this.text.matchAll(/\[Image #\d+\]/g)].map((match) => match[0]);
			for (const [index, image] of this.images.entries()) {
				this.addChild(new Spacer(1));
				this.addChild(new FramedImage(image, labels[index] ?? `[Image ${index + 1}]`, this.textPad()));
			}
		}
	}

	private createMarkdown(text: string): Markdown {
		return new Markdown(
			text,
			this.textPad(),
			0,
			this.markdownTheme,
			{
				color: (content: string) => theme.fg("userMessageText", content),
				bgColor: (content: string) => theme.bg("userMessageBg", content),
			},
			{
				preserveOrderedListMarkers: true,
				preserveBackslashEscapes: true,
				// Users type shell commands and prices far more often than math: show `$` as typed.
				renderLatex: false,
				transform: createMarkdownTransform("user", false, this.markdownTransformers),
			},
		);
	}

	override render(width: number): string[] {
		// Markers are highlighted in the message text only; the image frames color their own labels.
		const restore = theme.getFgAnsi("userMessageText");
		const lines = this.children.flatMap((child) => {
			const childLines = child.render(width);
			return child instanceof Markdown
				? childLines.map((line) => highlightAttachmentMarkers(line, restore))
				: childLines;
		});
		if (lines.length === 0) {
			return lines;
		}
		if (this.timestamp !== undefined) {
			prefixMessageTime(lines, this.outputPad, this.timestamp, (text) => theme.bg("userMessageBg", text));
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}
}
