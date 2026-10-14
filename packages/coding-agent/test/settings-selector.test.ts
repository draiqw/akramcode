import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	type SettingsCallbacks,
	SettingsSelectorComponent,
} from "../src/modes/interactive/components/settings-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("SettingsSelectorComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	it("shows only the accent color and auto-compact, and cycles the accent", () => {
		const callbacks: SettingsCallbacks = {
			onAccentColorChange: vi.fn(),
			onAutoCompactChange: vi.fn(),
			onCancel: () => {},
		};
		const list = new SettingsSelectorComponent(
			{ accentColor: "green", autoCompact: true },
			callbacks,
		).getSettingsList();

		const output = stripAnsi(list.render(80).join("\n"));
		expect(output).toContain("Accent color");
		expect(output).toContain("Auto-compact");
		expect(output).not.toContain("Hide thinking");

		list.handleInput("\r");
		list.handleInput("\r");
		expect(vi.mocked(callbacks.onAccentColorChange).mock.calls.flat()).toEqual(["blue", "violet"]);
	});
});
