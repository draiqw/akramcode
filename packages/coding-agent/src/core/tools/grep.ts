import { readFile as fsReadFile, stat as fsStat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { AgentTool } from "@akramcode/agent-core";
import { spawn } from "child_process";
import path from "path";
import { type Static, Type } from "typebox";
import { ensureTool } from "../../utils/tools-manager.ts";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { hasRecentFileMutation } from "./file-mutation-queue.ts";
import {
	buildTgrepArgs,
	findTgrepServer,
	TGREP_MAX_OUTPUT_BYTES_AFTER_LIMIT,
	TGREP_MUTATION_GRACE_MS,
	TGREP_SERVER_MARKER,
	TGREP_TIMEOUT_MS,
} from "./grep-tgrep.ts";
import { resolveToCwd } from "./path-utils.ts";
import { grepRenderers } from "./renderers/grep.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import {
	DEFAULT_MAX_BYTES,
	formatSize,
	GREP_MAX_LINE_LENGTH,
	type TruncationResult,
	truncateHead,
	truncateLine,
} from "./truncate.ts";

const grepSchema = Type.Object({
	pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
	path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
	glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
	ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
	literal: Type.Optional(
		Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" }),
	),
	context: Type.Optional(
		Type.Number({ description: "Number of lines to show before and after each match (default: 0)" }),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
});

export const grepToolSystemPromptContribution = {
	snippet: "Search file contents for patterns (respects .gitignore)",
	guidelines: [],
} as const;

export type GrepToolInput = Static<typeof grepSchema>;
const DEFAULT_LIMIT = 100;

export interface GrepToolDetails {
	truncation?: TruncationResult;
	matchLimitReached?: number;
	linesTruncated?: boolean;
}

/**
 * Pluggable operations for the grep tool.
 * Override these to delegate search to remote systems (for example SSH).
 */
export interface GrepOperations {
	/** Check if path is a directory. Throws if path does not exist. */
	isDirectory: (absolutePath: string) => Promise<boolean> | boolean;
	/** Read file contents for context lines */
	readFile: (absolutePath: string) => Promise<string> | string;
}

const defaultGrepOperations: GrepOperations = {
	isDirectory: async (p) => (await fsStat(p)).isDirectory(),
	readFile: (p) => fsReadFile(p, "utf-8"),
};

/**
 * Search program. `tgrep` asks a running `tgrep serve` for directory searches on this machine and
 * uses ripgrep whenever that is not possible.
 */
export type GrepBackend = "rg" | "tgrep";

export interface GrepToolOptions {
	/** Custom operations for grep. Default: local filesystem plus ripgrep */
	operations?: GrepOperations;
	/** Search program. Default: "rg". "tgrep" is ignored when custom operations are set. */
	backend?: GrepBackend;
	/** tgrep executable. Default: "tgrep" from PATH. */
	tgrepPath?: string;
}

interface GrepMatch {
	filePath: string;
	lineNumber: number;
	lineText?: string;
}

interface SearchProcessResult {
	matches: GrepMatch[];
	matchLimitReached: boolean;
	stderr: string;
}

interface SearchProcessOptions {
	/** Name used in error messages. */
	programName: string;
	limit: number;
	signal?: AbortSignal;
	/** Kill the process at the match limit instead of letting it finish. */
	stopAtLimit: boolean;
	/** Without `stopAtLimit`: kill the process and fail when the limit is reached and the output exceeds this size. */
	maxOutputBytesAfterLimit?: number;
	timeoutMs?: number;
}

/** Run a program that prints ripgrep `--json` events and collect up to `limit` matches. */
function runSearchProcess(
	command: string,
	args: string[],
	options: SearchProcessOptions,
): Promise<SearchProcessResult> {
	const { programName, limit, signal } = options;
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Operation aborted"));
			return;
		}
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		const rl = createInterface({ input: child.stdout });
		let stderr = "";
		let matchLimitReached = false;
		let aborted = false;
		let timedOut = false;
		let outputTooLarge = false;
		let killedDueToLimit = false;
		let outputBytes = 0;
		let settled = false;
		const matches: GrepMatch[] = [];

		const stopChild = (dueToLimit = false) => {
			if (!child.killed) {
				killedDueToLimit = dueToLimit;
				child.kill();
			}
		};
		const onAbort = () => {
			aborted = true;
			stopChild();
		};
		const timer =
			options.timeoutMs === undefined
				? undefined
				: setTimeout(() => {
						timedOut = true;
						stopChild();
					}, options.timeoutMs);
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			rl.close();
			signal?.removeEventListener("abort", onAbort);
			if (timer) clearTimeout(timer);
			fn();
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		const maxOutputBytes = options.maxOutputBytesAfterLimit;
		if (maxOutputBytes !== undefined) {
			child.stdout.on("data", (chunk: Buffer) => {
				outputBytes += chunk.length;
				if (matchLimitReached && outputBytes > maxOutputBytes && !outputTooLarge) {
					outputTooLarge = true;
					stopChild();
				}
			});
		}

		rl.on("line", (line) => {
			if (!line.trim() || matches.length >= limit) return;
			let event: any;
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}
			if (event.type !== "match") return;
			const filePath = event.data?.path?.text;
			const lineNumber = event.data?.line_number;
			const lineText = event.data?.lines?.text;
			if (filePath && typeof lineNumber === "number") matches.push({ filePath, lineNumber, lineText });
			if (matches.length >= limit) {
				matchLimitReached = true;
				if (options.stopAtLimit) stopChild(true);
			}
		});

		child.on("error", (error) => {
			finish(() => reject(new Error(`Failed to run ${programName}: ${error.message}`)));
		});
		child.on("close", (code) => {
			if (aborted) {
				finish(() => reject(new Error("Operation aborted")));
				return;
			}
			if (timedOut) {
				finish(() => reject(new Error(`${programName} timed out`)));
				return;
			}
			if (outputTooLarge) {
				finish(() => reject(new Error(`${programName} printed too much output`)));
				return;
			}
			if (!killedDueToLimit && code !== 0 && code !== 1) {
				const errorMsg = stderr.trim() || `${programName} exited with code ${code}`;
				finish(() => reject(new Error(errorMsg)));
				return;
			}
			finish(() => resolve({ matches, matchLimitReached, stderr }));
		});
	});
}

export function createGrepToolDefinition(
	cwd: string,
	options?: GrepToolOptions,
): ToolDefinition<typeof grepSchema, GrepToolDetails | undefined> {
	const customOps = options?.operations;
	// tgrep reads the host filesystem, so it only replaces ripgrep for the default operations.
	const tgrepCommand = options?.backend === "tgrep" && !customOps ? options.tgrepPath || "tgrep" : undefined;
	return {
		name: "grep",
		label: "grep",
		description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
		promptSnippet: grepToolSystemPromptContribution.snippet,
		parameters: grepSchema,
		async execute(
			_toolCallId,
			{
				pattern,
				path: searchDir,
				glob,
				ignoreCase,
				literal,
				context,
				limit,
			}: {
				pattern: string;
				path?: string;
				glob?: string;
				ignoreCase?: boolean;
				literal?: boolean;
				context?: number;
				limit?: number;
			},
			signal?: AbortSignal,
			_onUpdate?,
			ctx?: ExtensionContext,
		) {
			if (signal?.aborted) throw new Error("Operation aborted");

			const searchPath = resolveToCwd(searchDir || ".", ctx?.cwd || cwd);
			const ops = customOps ?? defaultGrepOperations;
			const contextValue = context && context > 0 ? context : 0;
			const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);

			// See docs/adr/coding-agent/core-tools-grep.md#tgrep-backend
			const runTgrep = async (isDirectory: boolean): Promise<SearchProcessResult | undefined> => {
				if (!tgrepCommand || !isDirectory || hasRecentFileMutation(TGREP_MUTATION_GRACE_MS)) return undefined;
				const server = await findTgrepServer(searchPath, tgrepCommand);
				if (!server) return undefined;
				const { indexDir } = server;
				const args = buildTgrepArgs({
					indexDir,
					pattern,
					searchPath,
					glob,
					ignoreCase,
					literal,
					limit: effectiveLimit,
				});
				try {
					const result = await runSearchProcess(server.binary, args, {
						programName: "tgrep",
						limit: effectiveLimit,
						signal,
						stopAtLimit: false,
						maxOutputBytesAfterLimit: TGREP_MAX_OUTPUT_BYTES_AFTER_LIMIT,
						timeoutMs: TGREP_TIMEOUT_MS,
					});
					// Without the server tgrep answers from a possibly stale on-disk index or a slow scan.
					if (!result.stderr.includes(TGREP_SERVER_MARKER)) return undefined;
					// A directory the index ignores, such as node_modules/pkg, has no indexed files, while
					// ripgrep searches it when it is named. Let ripgrep confirm an empty result below the root.
					if (result.matches.length === 0 && path.resolve(searchPath) !== path.dirname(indexDir)) return undefined;
					return result;
				} catch (error) {
					if (signal?.aborted) throw error;
					return undefined;
				}
			};

			const resolveRipgrep = async (): Promise<string> => {
				const rgPath = await ensureTool("rg");
				if (!rgPath) throw new Error("ripgrep (rg) is not available and could not be downloaded");
				return rgPath;
			};
			// Without tgrep, a missing ripgrep is reported before the path check.
			let rgPath = tgrepCommand ? undefined : await resolveRipgrep();

			const runRipgrep = async (): Promise<SearchProcessResult> => {
				rgPath ??= await resolveRipgrep();
				const args: string[] = ["--json", "--line-number", "--color=never", "--hidden"];
				if (ignoreCase) args.push("--ignore-case");
				if (literal) args.push("--fixed-strings");
				if (glob) args.push("--glob", glob);
				args.push("--", pattern, searchPath);
				return runSearchProcess(rgPath, args, {
					programName: "ripgrep",
					limit: effectiveLimit,
					signal,
					stopAtLimit: true,
				});
			};

			let isDirectory: boolean;
			try {
				isDirectory = await ops.isDirectory(searchPath);
			} catch {
				throw new Error(`Path not found: ${searchPath}`);
			}

			const { matches, matchLimitReached } = (await runTgrep(isDirectory)) ?? (await runRipgrep());
			if (matches.length === 0) {
				return { content: [{ type: "text", text: "No matches found" }], details: undefined };
			}

			const formatPath = (filePath: string): string => {
				if (isDirectory) {
					const relative = path.relative(searchPath, filePath);
					if (relative && !relative.startsWith("..")) {
						return relative.replace(/\\/g, "/");
					}
				}
				return path.basename(filePath);
			};

			const fileCache = new Map<string, string[]>();
			const getFileLines = async (filePath: string): Promise<string[]> => {
				let lines = fileCache.get(filePath);
				if (!lines) {
					try {
						const content = await ops.readFile(filePath);
						lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
					} catch {
						lines = [];
					}
					fileCache.set(filePath, lines);
				}
				return lines;
			};

			let linesTruncated = false;
			const formatBlock = async (filePath: string, lineNumber: number): Promise<string[]> => {
				const relativePath = formatPath(filePath);
				const lines = await getFileLines(filePath);
				if (!lines.length) return [`${relativePath}:${lineNumber}: (unable to read file)`];
				const block: string[] = [];
				const start = contextValue > 0 ? Math.max(1, lineNumber - contextValue) : lineNumber;
				const end = contextValue > 0 ? Math.min(lines.length, lineNumber + contextValue) : lineNumber;
				for (let current = start; current <= end; current++) {
					const lineText = lines[current - 1] ?? "";
					const sanitized = lineText.replace(/\r/g, "");
					const isMatchLine = current === lineNumber;
					// Truncate long lines so grep output stays compact.
					const { text: truncatedText, wasTruncated } = truncateLine(sanitized);
					if (wasTruncated) linesTruncated = true;
					if (isMatchLine) block.push(`${relativePath}:${current}: ${truncatedText}`);
					else block.push(`${relativePath}-${current}- ${truncatedText}`);
				}
				return block;
			};

			// See docs/adr/coding-agent/core-tools-grep.md#deferred-match-formatting-for-async-operations
			const outputLines: string[] = [];
			for (const match of matches) {
				if (contextValue === 0 && match.lineText !== undefined) {
					const relativePath = formatPath(match.filePath);
					const sanitized = match.lineText.replace(/\r\n/g, "\n").replace(/\r/g, "").replace(/\n$/, "");
					const { text: truncatedText, wasTruncated } = truncateLine(sanitized);
					if (wasTruncated) linesTruncated = true;
					outputLines.push(`${relativePath}:${match.lineNumber}: ${truncatedText}`);
				} else {
					const block = await formatBlock(match.filePath, match.lineNumber);
					outputLines.push(...block);
				}
			}

			const rawOutput = outputLines.join("\n");
			// See docs/adr/coding-agent/core-tools-grep.md#no-line-limit-in-output-truncation
			const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
			let output = truncation.content;
			const details: GrepToolDetails = {};
			// Build actionable notices for truncation and match limits.
			const notices: string[] = [];
			if (matchLimitReached) {
				notices.push(
					`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
				);
				details.matchLimitReached = effectiveLimit;
			}
			if (truncation.truncated) {
				notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
				details.truncation = truncation;
			}
			if (linesTruncated) {
				notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`);
				details.linesTruncated = true;
			}
			if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
			return {
				content: [{ type: "text", text: output }],
				details: Object.keys(details).length > 0 ? details : undefined,
			};
		},
		...grepRenderers,
	};
}

export function createGrepTool(cwd: string, options?: GrepToolOptions): AgentTool<typeof grepSchema> {
	return wrapToolDefinition(createGrepToolDefinition(cwd, options));
}
