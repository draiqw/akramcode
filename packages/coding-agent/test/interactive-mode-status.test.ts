import { homedir } from "node:os";
import * as path from "node:path";
import { type AutocompleteProvider, CombinedAutocompleteProvider } from "@akramcode/tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { type Component, Container, type Focusable, type TUI } from "../../tui/src/tui.ts";
import { TuiMainScreen } from "../../tui/src/tui-main-screen.ts";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import type { AutocompleteProviderFactory } from "../src/core/extensions/types.ts";
import type { QuietStartup } from "../src/core/settings-manager.ts";
import type { SourceInfo } from "../src/core/source-info.ts";
import type { AuthSelectorProvider } from "../src/modes/interactive/components/oauth-selector.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function renderLastLine(container: Container, width = 120): string {
	const last = container.children[container.children.length - 1];
	if (!last) return "";
	return last.render(width).join("\n");
}

function renderAll(container: Container, width = 120): string {
	return container.children.flatMap((child) => child.render(width)).join("\n");
}

class TestFocusableComponent implements Component, Focusable {
	focused = false;
	inputs: string[] = [];
	private readonly label: string;
	private text = "";

	constructor(label: string) {
		this.label = label;
	}

	handleInput(data: string): void {
		this.inputs.push(data);
	}

	getText(): string {
		return this.text;
	}

	setText(text: string): void {
		this.text = text;
	}

	render(): string[] {
		return [this.label];
	}

	invalidate(): void {}
}

async function flushTui(tui: TUI, terminal: VirtualTerminal): Promise<void> {
	tui.requestRender(true);
	await Promise.resolve();
	await terminal.waitForRender();
}

function normalizeRenderedOutput(container: Container, width = 220): string {
	return renderAll(container, width)
		.replace(/\u001b\[[0-9;]*m/g, "")
		.replace(/\\/g, "/")
		.split("\n")
		.map((line) => line.replace(/\s+$/g, ""))
		.join("\n")
		.trim();
}

type ExtensionFixture = {
	path: string;
	sourceInfo?: SourceInfo;
};

describe("InteractiveMode.showStatus", () => {
	beforeAll(() => {
		// showStatus uses the global theme instance
		initTheme("dark");
	});

	test("coalesces immediately-sequential status messages", () => {
		const fakeThis: any = {
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
			lastStatusSpacer: undefined,
			lastStatusText: undefined,
		};

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_ONE");
		expect(fakeThis.chatContainer.children).toHaveLength(2);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_ONE");

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_TWO");
		// second status updates the previous line instead of appending
		expect(fakeThis.chatContainer.children).toHaveLength(2);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_TWO");
		expect(renderLastLine(fakeThis.chatContainer)).not.toContain("STATUS_ONE");
	});

	test("appends a new status line if something else was added in between", () => {
		const fakeThis: any = {
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
			lastStatusSpacer: undefined,
			lastStatusText: undefined,
		};

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_ONE");
		expect(fakeThis.chatContainer.children).toHaveLength(2);

		// Something else gets added to the chat in between status updates
		fakeThis.chatContainer.addChild({ render: () => ["OTHER"], invalidate: () => {} });
		expect(fakeThis.chatContainer.children).toHaveLength(3);

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_TWO");
		// adds spacer + text
		expect(fakeThis.chatContainer.children).toHaveLength(5);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_TWO");
	});
});

describe("InteractiveMode.showManagedToolStatus", () => {
	beforeAll(() => initTheme("dark"));

	test("renders tool updates as one contiguous group", () => {
		const fakeThis: any = {
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
			managedToolStatusStarted: false,
			lastStatusSpacer: undefined,
			lastStatusText: undefined,
		};
		const showManagedToolStatus = (InteractiveMode as any).prototype.showManagedToolStatus;

		showManagedToolStatus.call(fakeThis, { type: "info", message: "fd downloading" });
		showManagedToolStatus.call(fakeThis, { type: "info", message: "rg downloading" });
		showManagedToolStatus.call(fakeThis, { type: "warning", message: "rg failed" });

		expect(fakeThis.chatContainer.children).toHaveLength(4);
		expect(normalizeRenderedOutput(fakeThis.chatContainer)).toBe(
			"fd downloading\n rg downloading\n Warning: rg failed",
		);
	});
});

describe("InteractiveMode.setToolsExpanded", () => {
	test("applies expansion state to the active header and chat entries", () => {
		const header = { setExpanded: vi.fn() };
		const loadedResourcesChild = { setExpanded: vi.fn() };
		const chatChild = { setExpanded: vi.fn() };
		const fakeThis: any = {
			toolOutputExpanded: false,
			customHeader: undefined,
			builtInHeader: header,
			loadedResourcesContainer: { children: [loadedResourcesChild] },
			chatContainer: { children: [chatChild] },
			ui: { requestRender: vi.fn() },
			showStatus: vi.fn(),
		};

		(InteractiveMode as any).prototype.setToolsExpanded.call(fakeThis, true);

		expect(fakeThis.toolOutputExpanded).toBe(true);
		expect(header.setExpanded).toHaveBeenCalledWith(true);
		expect(loadedResourcesChild.setExpanded).toHaveBeenCalledWith(true);
		expect(chatChild.setExpanded).toHaveBeenCalledWith(true);
		expect(fakeThis.showStatus).not.toHaveBeenCalled();
		expect(fakeThis.ui.requestRender).toHaveBeenCalled();
	});
});

describe("InteractiveMode.createExtensionUIContext setTheme", () => {
	test("persists theme changes to settings manager", () => {
		initTheme("dark");

		let currentTheme = "dark";
		const settingsManager = {
			getTheme: vi.fn(() => currentTheme),
			setTheme: vi.fn((theme: string) => {
				currentTheme = theme;
			}),
		};
		const fakeThis: any = {
			session: { settingsManager },
			settingsManager,
			themeController: {
				setThemeInstance: vi.fn(() => ({ success: true })),
				setThemeName: vi.fn(() => {
					fakeThis.ui.requestRender();
					return { success: true };
				}),
			},
			ui: { requestRender: vi.fn() },
		};

		const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
		const result = uiContext.setTheme("light");

		expect(result.success).toBe(true);
		expect(fakeThis.themeController.setThemeName).toHaveBeenCalledWith("light");
		expect(settingsManager.setTheme).toHaveBeenCalledWith("light");
		expect(currentTheme).toBe("light");
		expect(fakeThis.ui.requestRender).toHaveBeenCalledTimes(1);
	});

	test("does not persist invalid theme names", () => {
		initTheme("dark");

		const settingsManager = {
			getTheme: vi.fn(() => "dark"),
			setTheme: vi.fn(),
		};
		const fakeThis: any = {
			session: { settingsManager },
			settingsManager,
			themeController: {
				setThemeInstance: vi.fn(() => ({ success: true })),
				setThemeName: vi.fn(() => ({ success: false, error: "Theme not found" })),
			},
			ui: { requestRender: vi.fn() },
		};

		const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
		const result = uiContext.setTheme("__missing_theme__");

		expect(result.success).toBe(false);
		expect(fakeThis.themeController.setThemeName).toHaveBeenCalledWith("__missing_theme__");
		expect(settingsManager.setTheme).not.toHaveBeenCalled();
		expect(fakeThis.ui.requestRender).not.toHaveBeenCalled();
	});
});

describe("InteractiveMode.showExtensionCustom", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("overlay custom UI reclaims input after non-overlay custom UI closes", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const ui: TUI = new TuiMainScreen(terminal);
		const editorContainer = new Container();
		const editor = new TestFocusableComponent("EDITOR");
		const palette = new TestFocusableComponent("PALETTE");
		const overlay = new TestFocusableComponent("OVERLAY");
		const replacement = new TestFocusableComponent("REPLACEMENT");
		let closeOverlay: (value: string) => void = () => {
			throw new Error("closeOverlay was not initialized");
		};
		let closeReplacement: (value: string) => void = () => {
			throw new Error("closeReplacement was not initialized");
		};
		const fakeThis = {
			editor,
			editorContainer,
			keybindings: {},
			ui,
			disposeActiveSelector: vi.fn(),
		};
		const showExtensionCustom = <T>(
			factory: (tui: TUI, theme: unknown, keybindings: unknown, done: (result: T) => void) => Component,
			options?: { overlay?: boolean },
		): Promise<T> =>
			(InteractiveMode as any).prototype.showExtensionCustom.call(fakeThis, factory, options) as Promise<T>;

		editorContainer.addChild(editor);
		ui.addChild(editorContainer);
		ui.addChild(palette);
		ui.setFocus(palette);
		ui.start();
		try {
			const overlayPromise = showExtensionCustom<string>(
				(_tui, _theme, _keybindings, done) => {
					closeOverlay = done;
					return overlay;
				},
				{ overlay: true },
			);
			await flushTui(ui, terminal);
			expect(overlay.focused).toBe(true);

			const replacementPromise = showExtensionCustom<string>((_tui, _theme, _keybindings, done) => {
				closeReplacement = done;
				return replacement;
			});
			await flushTui(ui, terminal);
			expect(replacement.focused).toBe(true);

			closeReplacement("done");
			await replacementPromise;
			await flushTui(ui, terminal);
			terminal.sendInput("x");
			await flushTui(ui, terminal);

			expect(overlay.inputs).toEqual(["x"]);
			expect(editor.inputs).toEqual([]);
			expect(overlay.focused).toBe(true);

			closeOverlay("closed");
			await overlayPromise;
		} finally {
			ui.stop();
		}
	});
});

describe("InteractiveMode.createExtensionUIContext addAutocompleteProvider", () => {
	test("stores wrapper factories and rebuilds autocomplete immediately", () => {
		const wrapper: AutocompleteProviderFactory = (current) => current;
		const fakeThis = {
			autocompleteProviderWrappers: [] as AutocompleteProviderFactory[],
			setupAutocompleteProvider: vi.fn(),
		};

		const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
		uiContext.addAutocompleteProvider(wrapper);

		expect(fakeThis.autocompleteProviderWrappers).toEqual([wrapper]);
		expect(fakeThis.setupAutocompleteProvider).toHaveBeenCalledTimes(1);
	});
});

describe("InteractiveMode.setupAutocompleteProvider", () => {
	test("stacks wrapper factories over a fresh base provider", () => {
		const defaultEditor = { setAutocompleteProvider: vi.fn() };
		const customEditor = { setAutocompleteProvider: vi.fn() };
		const calls: string[] = [];

		const wrap1: AutocompleteProviderFactory = (current): AutocompleteProvider => ({
			async getSuggestions(lines, cursorLine, cursorCol, options) {
				calls.push("getSuggestions:wrap1");
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			},
			applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
				calls.push("applyCompletion:wrap1");
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			},
			shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
				calls.push("shouldTrigger:wrap1");
				return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
			},
		});
		const wrap2: AutocompleteProviderFactory = (current): AutocompleteProvider => ({
			async getSuggestions(lines, cursorLine, cursorCol, options) {
				calls.push("getSuggestions:wrap2");
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			},
			applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
				calls.push("applyCompletion:wrap2");
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			},
			shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
				calls.push("shouldTrigger:wrap2");
				return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
			},
		});

		const fakeThis = {
			createBaseAutocompleteProvider: () => new CombinedAutocompleteProvider([], "/tmp/project", undefined),
			defaultEditor,
			editor: customEditor,
			autocompleteProviderWrappers: [wrap1, wrap2],
		};

		(InteractiveMode as any).prototype.setupAutocompleteProvider.call(fakeThis);

		expect(defaultEditor.setAutocompleteProvider).toHaveBeenCalledTimes(1);
		expect(customEditor.setAutocompleteProvider).toHaveBeenCalledTimes(1);
		const provider = defaultEditor.setAutocompleteProvider.mock.calls[0]?.[0] as AutocompleteProvider;
		expect(provider).toBe(customEditor.setAutocompleteProvider.mock.calls[0]?.[0]);
		expect(provider.shouldTriggerFileCompletion?.(["foo"], 0, 3)).toBe(true);
		expect(calls).toEqual(["shouldTrigger:wrap2", "shouldTrigger:wrap1"]);
	});

	test("merges triggerCharacters from wrapper factories", () => {
		const defaultEditor = { setAutocompleteProvider: vi.fn() };
		const customEditor = { setAutocompleteProvider: vi.fn() };
		const passThrough =
			(triggerCharacters: string[]): AutocompleteProviderFactory =>
			(current) => ({
				triggerCharacters,
				getSuggestions: (lines, cursorLine, cursorCol, options) =>
					current.getSuggestions(lines, cursorLine, cursorCol, options),
				applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
					current.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
			});

		const fakeThis = {
			createBaseAutocompleteProvider: () => new CombinedAutocompleteProvider([], "/tmp/project", undefined),
			defaultEditor,
			editor: customEditor,
			autocompleteProviderWrappers: [passThrough(["$"]), passThrough(["!"])],
		};

		(
			InteractiveMode as unknown as {
				prototype: { setupAutocompleteProvider: (this: typeof fakeThis) => void };
			}
		).prototype.setupAutocompleteProvider.call(fakeThis);

		const provider = defaultEditor.setAutocompleteProvider.mock.calls[0]?.[0] as AutocompleteProvider;
		expect(provider.triggerCharacters).toEqual(["$", "!"]);
	});
});

describe("InteractiveMode.createBaseAutocompleteProvider", () => {
	test("matches model command arguments across provider/model order", async () => {
		type TestModel = { id: string; provider: string; name: string };
		type FakeInteractiveMode = {
			session: {
				scopedModels: Array<{ model: TestModel }>;
				modelRuntime: { getAvailableSnapshot: () => TestModel[] };
				promptTemplates: [];
				extensionRunner: { getRegisteredCommands: () => [] };
				resourceLoader: { getSkills: () => { skills: [] } };
			};
			settingsManager: { getEnableSkillCommands: () => boolean };
			skillCommands: Map<string, string>;
			sessionManager: { getCwd: () => string };
			fdPath: null;
		};

		const createBaseAutocompleteProvider = (
			InteractiveMode as unknown as {
				prototype: { createBaseAutocompleteProvider(this: FakeInteractiveMode): AutocompleteProvider };
			}
		).prototype.createBaseAutocompleteProvider;
		const models = [
			{ id: "gpt-5.2-codex", provider: "deepseek", name: "GPT-5.2 Codex" },
			{ id: "gpt-5.5", provider: "openai-codex", name: "GPT-5.5" },
		];
		const fakeThis: FakeInteractiveMode = {
			session: {
				scopedModels: [],
				modelRuntime: { getAvailableSnapshot: () => models },
				promptTemplates: [],
				extensionRunner: { getRegisteredCommands: () => [] },
				resourceLoader: { getSkills: () => ({ skills: [] }) },
			},
			settingsManager: { getEnableSkillCommands: () => false },
			skillCommands: new Map(),
			sessionManager: { getCwd: () => "/tmp" },
			fdPath: null,
		};

		const provider = createBaseAutocompleteProvider.call(fakeThis);
		const line = "/model codexgpt";
		const suggestions = await provider.getSuggestions([line], 0, line.length, {
			signal: new AbortController().signal,
		});

		expect(suggestions?.items.map((item) => item.value)).toEqual(["openai-codex/gpt-5.5", "deepseek/gpt-5.2-codex"]);
	});

	test("matches login command arguments by provider id and name", async () => {
		type FakeInteractiveMode = {
			session: {
				scopedModels: [];
				modelRuntime: { getAvailableSnapshot: () => [] };
				promptTemplates: [];
				extensionRunner: { getRegisteredCommands: () => [] };
				resourceLoader: { getSkills: () => { skills: [] } };
			};
			settingsManager: { getEnableSkillCommands: () => boolean };
			skillCommands: Map<string, string>;
			sessionManager: { getCwd: () => string };
			fdPath: null;
			getLoginProviderOptions: () => AuthSelectorProvider[];
		};

		const createBaseAutocompleteProvider = (
			InteractiveMode as unknown as {
				prototype: { createBaseAutocompleteProvider(this: FakeInteractiveMode): AutocompleteProvider };
			}
		).prototype.createBaseAutocompleteProvider;
		const fakeThis: FakeInteractiveMode = {
			session: {
				scopedModels: [],
				modelRuntime: { getAvailableSnapshot: () => [] },
				promptTemplates: [],
				extensionRunner: { getRegisteredCommands: () => [] },
				resourceLoader: { getSkills: () => ({ skills: [] }) },
			},
			settingsManager: { getEnableSkillCommands: () => false },
			skillCommands: new Map(),
			sessionManager: { getCwd: () => "/tmp" },
			fdPath: null,
			getLoginProviderOptions: () => [
				{ id: "anthropic", name: "Anthropic", authType: "oauth", subscription: true },
				{ id: "anthropic", name: "Anthropic", authType: "api_key", subscription: true },
				{ id: "openai", name: "OpenAI", authType: "api_key" },
				{ id: "deepseek", name: "DeepSeek", authType: "oauth", subscription: false },
			],
		};

		const provider = createBaseAutocompleteProvider.call(fakeThis);
		const line = "/login subscription anthrop";
		const suggestions = await provider.getSuggestions([line], 0, line.length, {
			signal: new AbortController().signal,
		});

		expect(suggestions?.items).toEqual([
			{
				value: "anthropic",
				label: "anthropic",
				description: "Anthropic · subscription/API key",
			},
		]);

		// An OAuth sign-in without a subscription is an account.
		const accountLine = "/login deepseek";
		const accountSuggestions = await provider.getSuggestions([accountLine], 0, accountLine.length, {
			signal: new AbortController().signal,
		});
		expect(accountSuggestions?.items).toEqual([
			{ value: "deepseek", label: "deepseek", description: "DeepSeek · account" },
		]);
	});
});
describe("InteractiveMode.showLoadedResources", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	function createShowLoadedResourcesThis(options: {
		quietStartup: QuietStartup;
		verbose?: boolean;
		toolOutputExpanded?: boolean;
		cwd?: string;
		contextFiles?: Array<{ path: string; content?: string }>;
		systemPromptSource?: { path: string };
		appendSystemPromptSources?: Array<{ path: string }>;
		extensions?: ExtensionFixture[];
		skills?: Array<{ filePath: string; name: string }>;
		skillDiagnostics?: Array<{ type: "warning" | "error" | "collision"; message: string }>;
		useRealScopeGroups?: boolean;
	}) {
		const fakeThis: any = {
			options: { verbose: options.verbose ?? false },
			toolOutputExpanded: options.toolOutputExpanded ?? false,
			loadedResourcesContainer: new Container(),
			chatContainer: new Container(),
			settingsManager: {
				getQuietStartup: () => options.quietStartup,
			},
			sessionManager: {
				getCwd: () => options.cwd ?? "/tmp/project",
			},
			session: {
				promptTemplates: [],
				extensionRunner: {
					getCommandDiagnostics: () => [],
					getShortcutDiagnostics: () => [],
				},
				resourceLoader: {
					getPathMetadata: () => new Map(),
					getAgentsFiles: () => ({ agentsFiles: options.contextFiles ?? [] }),
					getSystemPromptSource: () => options.systemPromptSource,
					getAppendSystemPromptSources: () => options.appendSystemPromptSources ?? [],
					getSkills: () => ({
						skills: options.skills ?? [],
						diagnostics: options.skillDiagnostics ?? [],
					}),
					getPrompts: () => ({ prompts: [], diagnostics: [] }),
					getExtensions: () => ({ extensions: options.extensions ?? [], errors: [], runtime: {} }),
					getThemes: () => ({ themes: [], diagnostics: [] }),
				},
			},
			formatDisplayPath: (p: string) => (InteractiveMode as any).prototype.formatDisplayPath.call(fakeThis, p),
			formatExtensionDisplayPath: (p: string) =>
				(InteractiveMode as any).prototype.formatExtensionDisplayPath.call(fakeThis, p),
			getStartupExpansionState: () => (InteractiveMode as any).prototype.getStartupExpansionState.call(fakeThis),
			shouldShowStartupDetails: () => (InteractiveMode as any).prototype.shouldShowStartupDetails.call(fakeThis),
			buildScopeGroups: () => [],
			formatScopeGroups: () => "resource-list",
			isPackageSource: (sourceInfo?: SourceInfo) =>
				(InteractiveMode as any).prototype.isPackageSource.call(fakeThis, sourceInfo),
			getShortPath: (p: string, sourceInfo?: SourceInfo) =>
				(InteractiveMode as any).prototype.getShortPath.call(fakeThis, p, sourceInfo),
			formatDiagnostics: () => "diagnostics",
			getBuiltInCommandConflictDiagnostics: () => [],
		};

		if (options.useRealScopeGroups) {
			fakeThis.getScopeGroup = (sourceInfo?: SourceInfo) =>
				(InteractiveMode as any).prototype.getScopeGroup.call(fakeThis, sourceInfo);
			fakeThis.buildScopeGroups = (items: Array<{ path: string; sourceInfo?: SourceInfo }>) =>
				(InteractiveMode as any).prototype.buildScopeGroups.call(fakeThis, items);
			fakeThis.formatScopeGroups = (groups: unknown, formatOptions: unknown) =>
				(InteractiveMode as any).prototype.formatScopeGroups.call(fakeThis, groups, formatOptions);
		}

		return fakeThis;
	}

	function createSourceInfo(
		filePath: string,
		options: {
			source: string;
			scope: "user" | "project" | "temporary";
			origin: "package" | "top-level";
			baseDir?: string;
		},
	): SourceInfo {
		return {
			path: filePath,
			source: options.source,
			scope: options.scope,
			origin: options.origin,
			baseDir: options.baseDir,
		};
	}

	function createExtensionFixtures(): ExtensionFixture[] {
		return [
			{
				path: "/tmp/project/.akramcode/extensions/answer.ts",
				sourceInfo: createSourceInfo("/tmp/project/.akramcode/extensions/answer.ts", {
					source: "local",
					scope: "project",
					origin: "top-level",
					baseDir: "/tmp/project/.akramcode/extensions",
				}),
			},
			{
				path: "/tmp/project/.akramcode/extensions/local-index/index.ts",
				sourceInfo: createSourceInfo("/tmp/project/.akramcode/extensions/local-index/index.ts", {
					source: "local",
					scope: "project",
					origin: "top-level",
					baseDir: "/tmp/project/.akramcode/extensions",
				}),
			},
			{
				path: "/tmp/agent/extensions/user-index/index.ts",
				sourceInfo: createSourceInfo("/tmp/agent/extensions/user-index/index.ts", {
					source: "local",
					scope: "user",
					origin: "top-level",
					baseDir: "/tmp/agent/extensions",
				}),
			},
			{
				path: "/tmp/project/.akramcode/npm/node_modules/akramcode-markdown-preview/extensions/index.ts",
				sourceInfo: createSourceInfo(
					"/tmp/project/.akramcode/npm/node_modules/akramcode-markdown-preview/extensions/index.ts",
					{
						source: "npm:akramcode-markdown-preview",
						scope: "project",
						origin: "package",
						baseDir: "/tmp/project/.akramcode/npm/node_modules/akramcode-markdown-preview",
					},
				),
			},
			{
				path: "/tmp/project/.akramcode/npm/node_modules/@scope/akramcode-scoped/extensions/index.ts",
				sourceInfo: createSourceInfo(
					"/tmp/project/.akramcode/npm/node_modules/@scope/akramcode-scoped/extensions/index.ts",
					{
						source: "npm:@scope/akramcode-scoped",
						scope: "project",
						origin: "package",
						baseDir: "/tmp/project/.akramcode/npm/node_modules/@scope/akramcode-scoped",
					},
				),
			},
			{
				path: "/tmp/project/.akramcode/git/github.com/HazAT/interactive-subagents/extensions/index.ts",
				sourceInfo: createSourceInfo(
					"/tmp/project/.akramcode/git/github.com/HazAT/interactive-subagents/extensions/index.ts",
					{
						source: "git:github.com/HazAT/interactive-subagents",
						scope: "project",
						origin: "package",
						baseDir: "/tmp/project/.akramcode/git/github.com/HazAT/interactive-subagents",
					},
				),
			},
			{
				path: "/tmp/project/.akramcode/git/github.com/HazAT/interactive-subagents/extensions/subagents/index.ts",
				sourceInfo: createSourceInfo(
					"/tmp/project/.akramcode/git/github.com/HazAT/interactive-subagents/extensions/subagents/index.ts",
					{
						source: "git:github.com/HazAT/interactive-subagents",
						scope: "project",
						origin: "package",
						baseDir: "/tmp/project/.akramcode/git/github.com/HazAT/interactive-subagents",
					},
				),
			},
			{
				path: "/tmp/temp/cli-extension.ts",
				sourceInfo: createSourceInfo("/tmp/temp/cli-extension.ts", {
					source: "cli",
					scope: "temporary",
					origin: "top-level",
					baseDir: "/tmp/temp",
				}),
			},
		];
	}

	test("hides the resource listing until expanded", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: false,
			skills: [{ filePath: "/tmp/skill/SKILL.md", name: "commit" }],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			force: false,
		});

		expect(renderAll(fakeThis.loadedResourcesContainer)).toBe("");
	});

	test("shows full resource listing when expanded", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: false,
			toolOutputExpanded: true,
			skills: [{ filePath: "/tmp/skill/SKILL.md", name: "commit" }],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			force: false,
		});

		const output = renderAll(fakeThis.loadedResourcesContainer);
		expect(output).toContain("[Skills]");
		expect(output).toContain("resource-list");
		expect(output).not.toContain("commit");
	});

	test("shows full resource listing on verbose startup even when tool output is collapsed", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: true,
			verbose: true,
			toolOutputExpanded: false,
			skills: [{ filePath: "/tmp/skill/SKILL.md", name: "commit" }],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			force: false,
		});

		const output = renderAll(fakeThis.loadedResourcesContainer);
		expect(output).toContain("[Skills]");
		expect(output).toContain("resource-list");
		expect(output).not.toContain("commit");
	});

	test("captures mixed extension layouts in expanded output", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: false,
			toolOutputExpanded: true,
			extensions: createExtensionFixtures(),
			useRealScopeGroups: true,
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			force: false,
		});

		expect(normalizeRenderedOutput(fakeThis.loadedResourcesContainer)).toMatchInlineSnapshot(`
"[Extensions]
  project
    /tmp/project/.akramcode/extensions/answer.ts
    /tmp/project/.akramcode/extensions/local-index
    git:github.com/HazAT/interactive-subagents
      extensions
      extensions/subagents
    npm:@scope/akramcode-scoped
      extensions
    npm:akramcode-markdown-preview
      extensions
  user
    /tmp/agent/extensions/user-index
  path
    /tmp/temp/cli-extension.ts"`);
	});

	test("shows full context paths when expanded", () => {
		const home = homedir();
		const cwd = path.join(home, "Development", "akramcode");
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: false,
			toolOutputExpanded: true,
			cwd,
			contextFiles: [
				{ path: path.join(home, ".akramcode", "agent", "AGENTS.md") },
				{ path: path.join(cwd, "AGENTS.md") },
			],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			force: false,
		});

		const output = renderAll(fakeThis.loadedResourcesContainer).replace(/\\/g, "/");
		expect(output).toContain("[Context]");
		expect(output).toContain("~/.akramcode/agent/AGENTS.md");
		expect(output).toContain("~/Development/akramcode/AGENTS.md");
		expect(output).not.toContain("~/.akramcode/agent/AGENTS.md, AGENTS.md");
	});

	test("does not show verbose listing on quiet startup during reload", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: true,
			skills: [{ filePath: "/tmp/skill/SKILL.md", name: "commit" }],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			extensions: [{ path: "/tmp/ext/index.ts" }],
			force: false,
			showDiagnosticsWhenQuiet: true,
		});

		expect(fakeThis.loadedResourcesContainer.children).toHaveLength(0);
	});

	test("hides resource listing but keeps the startup header with header-only quiet startup", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: "header",
			skills: [{ filePath: "/tmp/skill/SKILL.md", name: "commit" }],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			force: false,
		});

		expect(fakeThis.loadedResourcesContainer.children).toHaveLength(0);
		expect((InteractiveMode as any).prototype.shouldShowStartupHeader.call(fakeThis)).toBe(true);
		expect((InteractiveMode as any).prototype.shouldShowStartupDetails.call(fakeThis)).toBe(false);
	});

	test("hides the startup header with full quiet startup unless verbose", () => {
		const quiet = createShowLoadedResourcesThis({ quietStartup: true });
		expect((InteractiveMode as any).prototype.shouldShowStartupHeader.call(quiet)).toBe(false);
		const verbose = createShowLoadedResourcesThis({ quietStartup: "header", verbose: true });
		expect((InteractiveMode as any).prototype.shouldShowStartupDetails.call(verbose)).toBe(true);
	});

	test("still shows diagnostics on quiet startup when requested", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: true,
			skills: [{ filePath: "/tmp/skill/SKILL.md", name: "commit" }],
			skillDiagnostics: [{ type: "warning", message: "duplicate skill name" }],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			force: false,
			showDiagnosticsWhenQuiet: true,
		});

		const output = renderAll(fakeThis.loadedResourcesContainer);
		expect(output).toContain("[Skill conflicts]");
		expect(output).not.toContain("[Skills]");
	});
});
