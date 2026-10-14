/**
 * Files and images the user attaches to an answer of the `question` tool.
 */

import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { ImageContent, ModelImageResizeOptions } from "@akramcode/ai";
import { resolveReadPath } from "../../core/tools/path-utils.ts";
import { processImage } from "../../utils/image-process.ts";
import { detectSupportedImageMimeTypeFromFile } from "../../utils/mime.ts";
import { stripBom } from "../../utils/text.ts";

/** Text files larger than this are cut; the model can read the rest with the `read` tool. */
export const MAX_ATTACHMENT_TEXT_BYTES = 64 * 1024;

export interface QuestionAttachment {
	/** Absolute path. Pasted clipboard images live in the system temp directory. */
	path: string;
	kind: "image" | "file";
	/** Size in bytes when attached. */
	size: number;
}

export interface LoadedAttachments {
	/** `<file>` blocks for the tool result text. */
	text: string;
	images: ImageContent[];
}

/** Strip the quotes and escapes terminals add when a file is dropped or pasted. */
function unquotePath(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.length >= 2 && (trimmed[0] === "'" || trimmed[0] === '"') && trimmed.endsWith(trimmed[0])) {
		return trimmed.slice(1, -1);
	}
	return trimmed.replace(/\\(.)/g, "$1");
}

/** The attachment for an existing regular file, or undefined. */
export async function describeAttachment(rawPath: string, cwd: string): Promise<QuestionAttachment | undefined> {
	const candidate = unquotePath(rawPath.startsWith("@") ? rawPath.slice(1) : rawPath);
	if (!candidate) return undefined;
	const path = resolve(resolveReadPath(candidate, cwd));
	if (!existsSync(path)) return undefined;
	const stats = statSync(path);
	if (!stats.isFile()) return undefined;
	const kind = (await detectSupportedImageMimeTypeFromFile(path)) ? "image" : "file";
	return { path, kind, size: stats.size };
}

/**
 * Pasted text that names only existing files, one per line, as terminals produce when files are
 * dropped onto them. Returns undefined for any other text, which then goes into the editor.
 */
export async function attachmentsFromPastedText(text: string, cwd: string): Promise<QuestionAttachment[] | undefined> {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0 || lines.length > 20) return undefined;
	const attachments: QuestionAttachment[] = [];
	for (const line of lines) {
		const attachment = await describeAttachment(line, cwd);
		if (!attachment) return undefined;
		attachments.push(attachment);
	}
	return attachments;
}

/** `@path` mentions of existing files in the answer text. */
export async function attachmentsFromMentions(text: string, cwd: string): Promise<QuestionAttachment[]> {
	const attachments: QuestionAttachment[] = [];
	for (const match of text.matchAll(/(?:^|\s)@("[^"]+"|\S+)/g)) {
		const attachment = await describeAttachment(match[1], cwd);
		if (attachment) attachments.push(attachment);
	}
	return attachments;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentLabel(attachment: QuestionAttachment): string {
	return `${basename(attachment.path)} (${attachment.kind}, ${formatBytes(attachment.size)})`;
}

/** Read attachments into tool result content. Unreadable files become a note instead of an error. */
export async function loadAttachments(
	attachments: readonly QuestionAttachment[],
	options: { supportsImages: boolean; resizeOptions?: ModelImageResizeOptions },
): Promise<LoadedAttachments> {
	let text = "";
	const images: ImageContent[] = [];
	const seen = new Set<string>();
	for (const attachment of attachments) {
		if (seen.has(attachment.path)) continue;
		seen.add(attachment.path);
		try {
			if (attachment.kind === "image") {
				if (!options.supportsImages) {
					text += `<file name="${attachment.path}">[Image not attached: the current model does not support images.]</file>\n`;
					continue;
				}
				const mimeType = await detectSupportedImageMimeTypeFromFile(attachment.path);
				const processed = mimeType
					? await processImage(await readFile(attachment.path), mimeType, { resizeOptions: options.resizeOptions })
					: undefined;
				if (!processed?.ok) {
					text += `<file name="${attachment.path}">${processed?.message ?? "[Image could not be read.]"}</file>\n`;
					continue;
				}
				images.push({ type: "image", mimeType: processed.mimeType, data: processed.data });
				const note = [
					`[Image ${images.length} of this answer, attached below as ${processed.mimeType}.]`,
					...processed.hints,
				];
				text += `<file name="${attachment.path}">${note.join("\n")}</file>\n`;
				continue;
			}
			const buffer = await readFile(attachment.path);
			if (buffer.includes(0)) {
				text += `<file name="${attachment.path}">[Binary file, ${formatBytes(buffer.length)}; not inlined.]</file>\n`;
				continue;
			}
			let content = stripBom(buffer.subarray(0, MAX_ATTACHMENT_TEXT_BYTES).toString("utf-8"));
			if (buffer.length > MAX_ATTACHMENT_TEXT_BYTES) {
				content += `\n[Truncated at ${formatBytes(MAX_ATTACHMENT_TEXT_BYTES)} of ${formatBytes(buffer.length)}. Use the read tool for the rest.]`;
			}
			text += `<file name="${attachment.path}">\n${content}\n</file>\n`;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			text += `<file name="${attachment.path}">[Could not read file: ${message}]</file>\n`;
		}
	}
	return { text, images };
}
