import { Container, type SettingItem, SettingsList } from "@akramcode/tui";
import { ACCENT_COLORS } from "../theme/system-theme.ts";
import { getSettingsListTheme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";

export interface SettingsConfig {
	accentColor: string;
	autoCompact: boolean;
}

export interface SettingsCallbacks {
	onAccentColorChange: (accent: string) => void;
	onAutoCompactChange: (enabled: boolean) => void;
	onCancel: () => void;
}

/**
 * Main settings selector component. Everything else is configured in settings.json.
 */
export class SettingsSelectorComponent extends Container {
	private settingsList: SettingsList;

	constructor(config: SettingsConfig, callbacks: SettingsCallbacks) {
		super();

		const items: SettingItem[] = [
			{
				id: "accent-color",
				label: "Accent color",
				description: "Main interface color",
				currentValue: config.accentColor,
				values: [...ACCENT_COLORS],
			},
			{
				id: "autocompact",
				label: "Auto-compact",
				description: "Automatically compact context when it gets too large",
				currentValue: config.autoCompact ? "true" : "false",
				values: ["true", "false"],
			},
		];

		this.addChild(new DynamicBorder());
		this.settingsList = new SettingsList(
			items,
			10,
			getSettingsListTheme(),
			(id, newValue) => {
				switch (id) {
					case "accent-color":
						callbacks.onAccentColorChange(newValue);
						break;
					case "autocompact":
						callbacks.onAutoCompactChange(newValue === "true");
						break;
				}
			},
			callbacks.onCancel,
			{ enableSearch: true },
		);
		this.addChild(this.settingsList);
		this.addChild(new DynamicBorder());
	}

	getSettingsList(): SettingsList {
		return this.settingsList;
	}
}
