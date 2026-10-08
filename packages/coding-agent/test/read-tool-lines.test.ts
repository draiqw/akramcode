import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Text } from "@akramcode/tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionToolContext } from "../src/core/extensions/types.ts";
import { createEditTool } from "../src/core/tools/edit.ts";
import { createReadToolDefinition, type ReadToolInput } from "../src/core/tools/read.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

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
			"1\ta\n2\tb\n\n[1 more lines in file. Use offset=3 to continue.]",
		);
		// The last line: nothing remains, so there is no continuation notice.
		expect(await read("three.txt", "a\nb\nc\n", { offset: 3, limit: 1 })).toBe("3\tc");
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
		expect(await read("blank.txt", "a\n\n", { offset: 2 })).toBe("2\t");
		await expect(read("blank.txt", "a\n\n", { offset: 3 })).rejects.toThrow("beyond end of file (2 lines total)");
		expect(await read("plain.txt", "a\nb", { limit: 1 })).toBe(
			"1\ta\n\n[1 more lines in file. Use offset=2 to continue.]",
		);
		expect(await read("crlf.txt", "a\r\nb\r\n", { offset: 2 })).toBe("2\tb\r");
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

	it("numbers lines with their position in the file", async () => {
		const text = await read("five.txt", "one\ntwo\nthree\nfour\nfive\n", { offset: 4 });
		expect(text).toBe("4\tfour\n5\tfive");
		// Tabs inside a line stay after the number's tab.
		expect(await read("tabs.txt", "\tindented\n")).toBe("1\t\tindented");
	});

	it("lets edit apply oldText copied with read's line numbers", async () => {
		const path = join(dir, "code.js");
		writeFileSync(path, "const a = 1;\nconst b = 2;\nconst c = 3;\n");
		const edit = createEditTool(dir);
		await edit.execute("call", {
			path: "code.js",
			edits: [{ oldText: "2\tconst b = 2;\n3\tconst c = 3;", newText: "2\tconst b = 20;\n3\tconst c = 30;" }],
		});
		expect(readFileSync(path, "utf8")).toBe("const a = 1;\nconst b = 20;\nconst c = 30;\n");
		// Text that really starts with a number and a tab is matched as written.
		writeFileSync(path, "1\tliteral\n");
		await edit.execute("call", { path: "code.js", edits: [{ oldText: "1\tliteral", newText: "1\tchanged" }] });
		expect(readFileSync(path, "utf8")).toBe("1\tchanged\n");
	});

	it("renders numbers as a dimmed gutter, not as file text", async () => {
		initTheme("dark");
		const definition = createReadToolDefinition(dir);
		writeFileSync(join(dir, "plain.txt"), "alpha\nbeta\n");
		const result = await definition.execute("call", { path: "plain.txt" }, undefined, undefined, noContext);
		const component = definition.renderResult?.(result, { expanded: true, isPartial: false }, theme, {
			args: { path: "plain.txt" },
			cwd: dir,
			showImages: false,
			isError: false,
		} as never) as Text;
		const rendered = component
			.render(80)
			.join("\n")
			.replace(/\x1b\[[0-9;]*m/g, "");
		expect(rendered).toContain("1 alpha");
		expect(rendered).toContain("2 beta");
		expect(rendered).not.toContain("\t");
	});
});
