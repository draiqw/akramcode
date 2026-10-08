/**
 * File access helpers for the traces server: bounded line reading and containment checks that
 * keep reads inside the configured session and trace directories, even through symlinks.
 */

import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";

/** Longest line kept when reading JSONL; longer lines are skipped instead of buffered. */
export const MAX_LINE_BYTES = 64 * 1024 * 1024;

/** True when `child` is `root` or inside it. Both must be real (symlink-free) absolute paths. */
export function isInside(root: string, child: string): boolean {
	const rel = relative(root, child);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function realpathOrUndefined(path: string): Promise<string | undefined> {
	try {
		return await realpath(path);
	} catch {
		return undefined;
	}
}

/**
 * Real path of a regular file if it lies inside one of `realRoots`, otherwise undefined. Symlinks
 * are resolved first, so a link that points outside the roots is rejected.
 */
export async function resolveContainedFile(path: string, realRoots: readonly string[]): Promise<string | undefined> {
	const real = await realpathOrUndefined(path);
	if (!real || !realRoots.some((root) => isInside(root, real))) return undefined;
	try {
		return (await lstat(real)).isFile() ? real : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Lines of a file, split on `\n`. A line longer than `maxLineBytes` is never held in memory: it
 * yields `null` and its bytes are skipped.
 */
export async function* readLinesBounded(
	path: string,
	maxLineBytes: number = MAX_LINE_BYTES,
): AsyncGenerator<string | null> {
	let parts: Buffer[] = [];
	let partBytes = 0;
	let skipping = false;
	const finishLine = (): string | null => {
		const line = skipping ? null : Buffer.concat(parts, partBytes).toString("utf8");
		parts = [];
		partBytes = 0;
		skipping = false;
		return line;
	};
	for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
		let start = 0;
		while (start <= chunk.length) {
			const newline = chunk.indexOf(10, start);
			const end = newline === -1 ? chunk.length : newline;
			if (!skipping && end > start) {
				if (partBytes + (end - start) > maxLineBytes) {
					skipping = true;
					parts = [];
					partBytes = 0;
				} else {
					// Copy, so a short line does not keep the whole read chunk alive.
					parts.push(Buffer.from(chunk.subarray(start, end)));
					partBytes += end - start;
				}
			}
			if (newline === -1) break;
			yield finishLine();
			start = newline + 1;
		}
	}
	if (partBytes > 0 || skipping) yield finishLine();
}
