import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import type { TUI } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

function createEditor(): Editor {
	const tui: TUI = new TuiMainScreen(new VirtualTerminal(80, 24));
	return new Editor(tui, defaultEditorTheme);
}

describe("Editor paste hooks", () => {
	it("reports an empty bracketed paste, e.g. Cmd+V with an image in the clipboard", () => {
		const editor = createEditor();
		let emptyPastes = 0;
		editor.onEmptyPaste = () => emptyPastes++;
		editor.handleInput("\x1b[200~\x1b[201~");
		editor.handleInput("\x1b[200~text\x1b[201~");
		assert.strictEqual(emptyPastes, 1);
		assert.strictEqual(editor.getText(), "text");
	});

	it("shows large pastes as a numbered marker and wraps them on submit", () => {
		const editor = createEditor();
		editor.wrapPastedText = (id, content) => `<p${id}>${content}</p${id}>`;
		let submitted = "";
		editor.onSubmit = (text) => {
			submitted = text;
		};
		const pasted = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");
		editor.handleInput(`\x1b[200~${pasted}\x1b[201~`);
		assert.strictEqual(editor.getText(), "[Pasted text #1 +12 lines]");
		assert.strictEqual(editor.getExpandedText(), pasted);

		editor.handleInput("\r");
		assert.strictEqual(submitted, `<p1>${pasted}</p1>`);
	});
});
