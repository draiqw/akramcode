import { describe, expect, test } from "vitest";
import {
	displayPastedText,
	formatMessageTime,
	UserMessageComponent,
	wrapPastedText,
} from "../src/modes/interactive/components/user-message.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const BG_RESET = "\x1b[49m";

describe("UserMessageComponent", () => {
	test("shows the send time before the text, on a background, inside the OSC 133 zone", () => {
		initTheme("dark");

		const timestamp = new Date(2026, 9, 10, 9, 5).getTime();
		const component = new UserMessageComponent("hello", undefined, 1, [], timestamp);
		const lines = component.render(20);

		expect(formatMessageTime(timestamp)).toBe("09:05");
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain(OSC133_ZONE_START);
		expect(lines[0]).toContain(OSC133_ZONE_END + OSC133_ZONE_FINAL);
		expect(
			stripAnsi(lines[0])
				.replace(/\x1b\]133;[ABC]\x07/g, "")
				.trimEnd(),
		).toBe(" 09:05 hello");
		expect(lines.join("")).toContain(BG_RESET);
	});

	test("aligns wrapped lines with the text after the send time", () => {
		initTheme("dark");

		const timestamp = new Date(2026, 9, 10, 13, 10).getTime();
		const lines = new UserMessageComponent("one\n\ntwo", undefined, 1, [], timestamp).render(40).map((line) =>
			stripAnsi(line)
				.replace(/\x1b\]133;[ABC]\x07/g, "")
				.trimEnd(),
		);

		expect(lines).toEqual([" 13:10 one", "", "       two"]);
	});

	test("renders only the text when no timestamp is given", () => {
		initTheme("dark");

		const lines = new UserMessageComponent("hello").render(20);

		expect(lines).toHaveLength(1);
		expect(stripAnsi(lines[0])).toContain("hello");
	});

	test("chains Markdown transformers with user message context", () => {
		initTheme("dark");
		const calls: string[] = [];
		const component = new UserMessageComponent("The input is $x^2$.", undefined, 1, [
			(markdown, context) => {
				calls.push("formula");
				expect(context).toEqual({ messageType: "user", isStreaming: false, availableWidth: 78 });
				return markdown.replace("$x^2$", "x²");
			},
			(markdown) => {
				calls.push("suffix");
				return `${markdown} Done.`;
			},
		]);

		expect(stripAnsi(component.render(80).join("\n"))).toContain("The input is x². Done.");
		expect(calls).toEqual(["formula", "suffix"]);
	});

	test("shows dollar signs as typed instead of rendering them as math", () => {
		initTheme("dark");
		const text = "for i in $(seq 1 40); do echo evt$i; done and $x^2$";
		const component = new UserMessageComponent(text);

		expect(stripAnsi(component.render(100).join("\n"))).toContain(text);
	});

	test("reapplies Markdown transformers when invalidated", () => {
		initTheme("dark");
		let suffix = "before";
		const component = new UserMessageComponent("Message", undefined, 1, [(markdown) => `${markdown} ${suffix}`]);

		expect(stripAnsi(component.render(80).join("\n"))).toContain("Message before");

		suffix = "after";
		component.invalidate();

		expect(stripAnsi(component.render(80).join("\n"))).toContain("Message after");
	});

	test("collapses pasted text to a marker until expanded", () => {
		initTheme("dark");
		const text = `look ${wrapPastedText(1, "a\nb\nc")} please`;
		expect(displayPastedText(text, false)).toBe("look [Pasted text #1 +3 lines] please");
		expect(displayPastedText(text, true)).toBe("look a\nb\nc please");

		const component = new UserMessageComponent(text, undefined, 1, [], undefined);
		const collapsed = stripAnsi(component.render(60).join("\n"));
		expect(collapsed).toContain("[Pasted text #1 +3 lines]");
		expect(collapsed).not.toContain("pasted_text");
		component.setExpanded(true);
		const expanded = stripAnsi(component.render(60).join("\n"));
		expect(expanded).toContain("╭─ [Pasted text #1] · 5 chars ─");
		expect(expanded).toContain("│ a");
		expect(expanded).not.toContain("+3 lines");
		// The frame keeps a right margin as wide as its left indent.
		const bottom = stripAnsi(component.render(60).find((line) => line.includes("╰"))!);
		expect(bottom.trimEnd().length).toBeLessThanOrEqual(60 - (bottom.length - bottom.trimStart().length));

		// Expanded pastes stay verbatim: a shell comment is not turned into a heading.
		const script = new UserMessageComponent(wrapPastedText(1, "# comment\nset -eu"), undefined, 1, [], undefined);
		script.setExpanded(true);
		expect(stripAnsi(script.render(60).join("\n"))).toContain("# comment");
	});

	test("frames expanded images with their marker, format, and size", () => {
		initTheme("dark");
		// 1x1 PNG
		const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
		const component = new UserMessageComponent("look [Image #3]", undefined, 1, [], undefined, [
			{ type: "image", data: png, mimeType: "image/png" },
		]);
		expect(stripAnsi(component.render(80).join("\n"))).not.toContain("╭─");

		component.setExpanded(true);
		const lines = stripAnsi(component.render(80).join("\n")).split("\n");
		expect(lines.some((line) => line.includes("╭─ [Image #3] · png 1×1 ─"))).toBe(true);
		expect(lines.some((line) => line.trimStart().startsWith("╰─"))).toBe(true);

		// The whole top rule keeps the accent color; marker highlighting must not reset it to the text color.
		const top = component.render(80).find((line) => line.includes("╭─"))!;
		expect(top).not.toContain(theme.getFgAnsi("userMessageText"));
	});
});
