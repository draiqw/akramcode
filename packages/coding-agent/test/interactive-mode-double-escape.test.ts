import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function createEscapeUI(text: string, settings: Parameters<typeof SettingsManager.inMemory>[0] = {}) {
	let editorText = text;
	const ui = {
		session: { isStreaming: false, isBashRunning: false },
		isBashMode: false,
		lastEscapeTime: 0,
		settingsManager: SettingsManager.inMemory(settings),
		editor: {
			getText: () => editorText,
			setText: vi.fn((value: string) => {
				editorText = value;
			}),
			addToHistory: vi.fn(),
		},
		showTreeSelector: vi.fn(),
		showUserMessageSelector: vi.fn(),
		showStatus: vi.fn(),
	};
	const handleEscape = Reflect.get(InteractiveMode.prototype, "handleEscape") as (this: typeof ui) => void;
	return { ui, press: () => handleEscape.call(ui), text: () => editorText };
}

describe("InteractiveMode double escape", () => {
	beforeEach(() => {
		initTheme("dark");
		vi.useFakeTimers();
		vi.setSystemTime(10_000);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("clears a draft on a quick second press and keeps it in history", () => {
		const { ui, press, text } = createEscapeUI("half-written prompt");
		press();
		expect(text()).toBe("half-written prompt");
		vi.setSystemTime(10_300);
		press();
		expect(text()).toBe("");
		expect(ui.editor.addToHistory).toHaveBeenCalledWith("half-written prompt");
		expect(ui.showStatus).toHaveBeenCalledWith(expect.stringContaining("Input cleared"));
		expect(ui.showTreeSelector).not.toHaveBeenCalled();
	});

	it("keeps the draft when presses are too far apart or the setting is off", () => {
		const slow = createEscapeUI("draft");
		slow.press();
		vi.setSystemTime(10_600);
		slow.press();
		expect(slow.text()).toBe("draft");

		const off = createEscapeUI("draft", { doubleEscapeClearsInput: false });
		off.press();
		off.press();
		expect(off.text()).toBe("draft");
		expect(off.ui.editor.addToHistory).not.toHaveBeenCalled();
	});

	it("still opens the tree on an empty editor", () => {
		const { ui, press } = createEscapeUI("");
		press();
		press();
		expect(ui.showTreeSelector).toHaveBeenCalledOnce();
	});
});
