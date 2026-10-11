import { describe, expect, it } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type NumberingContext = {
	pastedImages: Map<number, unknown>;
	session: { messages: Array<{ role: string; content: string }> };
	getUserMessageText(message: { content: string }): string;
};

const nextImageNumber = Reflect.get(InteractiveMode.prototype, "nextImageNumber") as (this: NumberingContext) => number;

describe("pasted image numbering", () => {
	it("continues after images in sent messages and pending pastes", () => {
		const context: NumberingContext = {
			pastedImages: new Map(),
			session: {
				messages: [
					{ role: "user", content: "[Image #1] first" },
					{ role: "assistant", content: "[Image #9] not counted" },
					{ role: "user", content: "[Image #2] [Image #3]" },
				],
			},
			getUserMessageText: (message) => message.content,
		};
		expect(nextImageNumber.call(context)).toBe(4);
		context.pastedImages.set(4, {});
		expect(nextImageNumber.call(context)).toBe(5);
	});
});
