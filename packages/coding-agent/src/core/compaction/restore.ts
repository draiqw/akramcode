/**
 * Context restored verbatim after compaction.
 *
 * A summary paraphrases. Two things lose too much that way: the request the agent is still working
 * on, and the files it was reading. After compaction the summary is followed by the request word for
 * word (while no later user message is kept) and by the latest content of recently read files, so the
 * model continues from the original instructions instead of a retelling. Both are carried across
 * repeated compactions and bounded in size.
 */

import type { AgentMessage } from "@akramcode/agent-core";
import { contentText } from "@akramcode/ai";

export const RESTORED_CONTEXT_MARKER = "<restored-context>";

export interface RestoredFile {
	path: string;
	content: string;
}

/** Stored on the compaction entry, so the next compaction can carry it forward. */
export interface RestoredContext {
	activeRequest?: string;
	restoredFiles?: RestoredFile[];
}

export interface RestoreLimits {
	requestChars: number;
	maxFiles: number;
	fileChars: number;
	totalFileChars: number;
}

export const DEFAULT_RESTORE_LIMITS: RestoreLimits = {
	requestChars: 8_000,
	maxFiles: 5,
	fileChars: 8_000,
	totalFileChars: 24_000,
};

function truncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n[... ${text.length - maxChars} more characters not restored]`;
}

function userText(message: AgentMessage): string | undefined {
	if (message.role !== "user") return undefined;
	const content = message.content;
	if (typeof content === "string") return content.trim() || undefined;
	const parts = content.map((block) => (block.type === "text" ? block.text : "[image]"));
	return parts.join("\n").trim() || undefined;
}

function pathOf(args: unknown): string | undefined {
	const path = (args as { path?: unknown } | undefined)?.path;
	return typeof path === "string" ? path : undefined;
}

/**
 * Builds the restored context for one compaction.
 *
 * @param summarized messages being replaced by the summary, oldest first
 * @param previous restored context of the previous compaction, if any
 * @param keptHasUserMessage whether a user message survives verbatim after the cut
 */
export function collectRestoredContext(
	summarized: AgentMessage[],
	previous: RestoredContext | undefined,
	keptHasUserMessage: boolean,
	limits: RestoreLimits = DEFAULT_RESTORE_LIMITS,
): RestoredContext {
	let activeRequest: string | undefined;
	if (!keptHasUserMessage) {
		for (const message of summarized) activeRequest = userText(message) ?? activeRequest;
		activeRequest ??= previous?.activeRequest;
	}

	const calls = new Map<string, { name: string; path?: string }>();
	const reads = new Map<string, string>();
	const touched = new Set<string>();
	for (const message of summarized) {
		if (message.role === "assistant") {
			for (const block of message.content) {
				if (block.type !== "toolCall") continue;
				const path = pathOf(block.arguments);
				calls.set(block.id, { name: block.name, path });
				if (!path) continue;
				touched.add(path);
				// A file changed after it was read: the read content is stale.
				if (block.name === "write" || block.name === "edit") reads.delete(path);
			}
		} else if (message.role === "toolResult") {
			const call = calls.get(message.toolCallId);
			if (call?.name !== "read" || !call.path || message.isError) continue;
			const text = contentText(message.content, "");
			if (!text) continue;
			reads.delete(call.path);
			reads.set(call.path, text);
		}
	}

	// Newest first: reads from this span, then older restored files not touched since.
	const candidates: RestoredFile[] = [...reads].reverse().map(([path, content]) => ({ path, content }));
	for (const file of previous?.restoredFiles ?? []) {
		if (!touched.has(file.path)) candidates.push(file);
	}
	const restoredFiles: RestoredFile[] = [];
	let total = 0;
	for (const file of candidates) {
		if (restoredFiles.length >= limits.maxFiles) break;
		const content = truncate(file.content, limits.fileChars);
		if (total + content.length > limits.totalFileChars) continue;
		total += content.length;
		restoredFiles.push({ path: file.path, content });
	}

	return {
		...(activeRequest ? { activeRequest: truncate(activeRequest, limits.requestChars) } : {}),
		...(restoredFiles.length > 0 ? { restoredFiles } : {}),
	};
}

/** Appended after the summary; empty when there is nothing to restore. */
export function formatRestoredContext(context: RestoredContext): string {
	const sections: string[] = [];
	if (context.activeRequest) {
		sections.push(
			`The user's request this work continues, verbatim:\n<active-request>\n${context.activeRequest}\n</active-request>`,
		);
	}
	if (context.restoredFiles?.length) {
		const files = context.restoredFiles.map((file) => `<file path="${file.path}">\n${file.content}\n</file>`);
		sections.push(
			`Content of recently read files as last read (read them again before editing):\n${files.join("\n")}`,
		);
	}
	if (sections.length === 0) return "";
	return `\n\n${RESTORED_CONTEXT_MARKER}\n${sections.join("\n\n")}\n</restored-context>`;
}

/** The summary without its restored context, for use as the next summarization's previous summary. */
export function stripRestoredContext(summary: string): string {
	const index = summary.indexOf(`\n\n${RESTORED_CONTEXT_MARKER}`);
	return index === -1 ? summary : summary.slice(0, index);
}
