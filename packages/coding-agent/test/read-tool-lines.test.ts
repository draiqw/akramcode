import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionToolContext } from "../src/core/extensions/types.ts";
import { createReadToolDefinition, type ReadToolInput } from "../src/core/tools/read.ts";

const noContext = undefined as unknown as ExtensionToolContext;

describe("read tool line counting and bounds", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "akramcode-read-lines-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	async function read(file: string, content: string, args: Omit<ReadToolInput, "path"> = {}): Promise<string> {
		writeFileSync(join(dir, file), content);
		const result = await createReadToolDefinition(dir).execute(
			"call",
			{ path: file, ...args },
			undefined,
			undefined,
			noContext,
		);
		return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
	}

	it("does not count the trailing newline as an extra line", async () => {
		expect(await read("three.txt", "a\nb\nc\n", { limit: 2 })).toBe(
			"a\nb\n\n[1 more lines in file. Use offset=3 to continue.]",
		);
		// The last line: nothing remains, so there is no continuation notice.
		expect(await read("three.txt", "a\nb\nc\n", { offset: 3, limit: 1 })).toBe("c");
		await expect(read("three.txt", "a\nb\nc\n", { offset: 4 })).rejects.toThrow(
			"Offset 4 is beyond end of file (3 lines total)",
		);
	});

	it("reports the real total when output is truncated", async () => {
		const lines = Array.from({ length: 5000 }, (_, i) => `line ${i + 1} ${"x".repeat(80)}`);
		const text = await read("big.txt", `${lines.join("\n")}\n`);
		expect(text).toMatch(/\[Showing lines 1-\d+ of 5000 /);
	});

	it("keeps empty lines, files without a trailing newline, and CRLF files", async () => {
		expect(await read("blank.txt", "a\n\n", { offset: 2 })).toBe("");
		await expect(read("blank.txt", "a\n\n", { offset: 3 })).rejects.toThrow("beyond end of file (2 lines total)");
		expect(await read("plain.txt", "a\nb", { limit: 1 })).toBe(
			"a\n\n[1 more lines in file. Use offset=2 to continue.]",
		);
		expect(await read("crlf.txt", "a\r\nb\r\n", { offset: 2 })).toBe("b\r");
		expect(await read("empty.txt", "")).toBe("");
	});

	it("rejects offset and limit values that are not positive integers", async () => {
		for (const limit of [0, -1, 1.5]) {
			await expect(read("three.txt", "a\nb\nc\n", { limit })).rejects.toThrow("limit must be a positive integer");
		}
		for (const offset of [0, -2, 2.5]) {
			await expect(read("three.txt", "a\nb\nc\n", { offset })).rejects.toThrow("offset must be a positive integer");
		}
	});
});
