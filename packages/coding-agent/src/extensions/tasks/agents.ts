/**
 * `/agents`: list the agent types the `agent` tool offers, create new ones with a tool picker,
 * and edit or delete user and project definitions.
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { type Component, Container, Text, type TUI } from "@akramcode/tui";
import { THINKING_LEVEL_OPTIONS } from "../../core/defaults.ts";
import type { ExtensionCommandContext, ExtensionContext } from "../../core/extensions/types.ts";
import type { KeybindingsManager } from "../../core/keybindings.ts";
import type { SubagentControl } from "../../core/subagents/agent-tool.ts";
import {
	type AgentTypeDefinition,
	isValidAgentTypeName,
	serializeAgentType,
} from "../../core/subagents/agent-types.ts";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";

const CREATE_ITEM = "+ Create new agent";
const PICKER_VISIBLE_ROWS = 15;

function truncate(text: string, max: number): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function describeTools(type: AgentTypeDefinition, resolved: { tools: string[] }): string {
	if (!type.tools && !type.disallowedTools) return "main agent's tools";
	return resolved.tools.length > 0 ? resolved.tools.join(", ") : "no tools";
}

/** One line per agent type for the `/agents` list. */
export function formatAgentTypeItem(
	type: AgentTypeDefinition,
	resolved: { tools: string[]; unknown: string[] },
): string {
	const warning = resolved.unknown.length > 0 ? " ⚠" : "";
	return `${type.name} (${type.source}) · ${truncate(describeTools(type, resolved), 60)}${warning}`;
}

/** Text of the `/agents` detail view. */
export function formatAgentTypeDetail(
	type: AgentTypeDefinition,
	resolved: { tools: string[]; unknown: string[] },
): string {
	const lines = [`${type.name} (${type.source})`, type.description, ""];
	if (type.filePath) lines.push(`File: ${type.filePath}`);
	lines.push(`Tools: ${describeTools(type, resolved)}`);
	if (type.tools) lines.push(`Allowlist: ${type.tools.join(", ")}`);
	if (type.disallowedTools) lines.push(`Denylist: ${type.disallowedTools.join(", ")}`);
	if (resolved.unknown.length > 0) lines.push(`Warning: no tool matches ${resolved.unknown.join(", ")}`);
	lines.push(`Model: ${type.model ?? "inherit"}`, `Thinking: ${type.thinking ?? "inherit"}`);
	const prompt = type.systemPrompt.split("\n");
	lines.push("", ...prompt.slice(0, 12), ...(prompt.length > 12 ? [`… (${prompt.length - 12} more lines)`] : []));
	return lines.join("\n");
}

/** Warnings about agent definitions: file problems and tool names that match no tool. */
export function collectAgentWarnings(control: SubagentControl, options?: { includeMcp?: boolean }): string[] {
	const { types, diagnostics } = control.listTypes();
	const warnings = diagnostics.map((diagnostic) => `Agent definition ${diagnostic.path}: ${diagnostic.message}`);
	for (const type of types) {
		// MCP servers connect after startup, so their tools may not exist yet.
		const unknown = control
			.resolveTools(type)
			.unknown.filter((name) => options?.includeMcp || !name.startsWith("mcp__"));
		if (unknown.length > 0) warnings.push(`Agent "${type.name}": no tool matches ${unknown.join(", ")}`);
	}
	return warnings;
}

/** Multi-select over the session's tools. Resolves to the chosen names, or undefined when cancelled. */
export class ToolPickerComponent extends Container {
	private readonly tools: Array<{ name: string; description: string }>;
	private readonly selected: Set<string>;
	private readonly keybindings: KeybindingsManager;
	private readonly theme: Theme;
	private readonly tui: TUI;
	private readonly done: (result: string[] | undefined) => void;
	private index = 0;

	constructor(
		tools: Array<{ name: string; description: string }>,
		initial: string[],
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		done: (result: string[] | undefined) => void,
	) {
		super();
		this.tools = tools;
		this.selected = new Set(initial);
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.done = done;
		this.rebuild();
	}

	/** Rows: the tools, then "Done". */
	private get rowCount(): number {
		return this.tools.length + 1;
	}

	private rebuild(): void {
		this.clear();
		const theme = this.theme;
		this.addChild(new Text(theme.fg("accent", theme.bold("Tools for the new agent")), 1, 0));
		this.addChild(
			new Text(
				theme.fg("muted", "Select none to give the agent the main agent's tools (except agent tools)."),
				1,
				0,
			),
		);
		const start = Math.max(
			0,
			Math.min(this.index - Math.floor(PICKER_VISIBLE_ROWS / 2), this.rowCount - PICKER_VISIBLE_ROWS),
		);
		const end = Math.min(this.rowCount, start + PICKER_VISIBLE_ROWS);
		const lines: string[] = [];
		if (start > 0) lines.push(theme.fg("dim", `  ↑ ${start} more`));
		for (let row = start; row < end; row++) {
			const cursor = row === this.index ? theme.fg("accent", "→ ") : "  ";
			if (row === this.tools.length) {
				lines.push(`${cursor}${theme.fg("success", `Done (${this.selected.size} selected)`)}`);
				continue;
			}
			const tool = this.tools[row];
			const box = this.selected.has(tool.name) ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
			lines.push(`${cursor}${box} ${tool.name} ${theme.fg("dim", truncate(tool.description, 60))}`);
		}
		if (end < this.rowCount) lines.push(theme.fg("dim", `  ↓ ${this.rowCount - end} more`));
		this.addChild(new Text(lines.join("\n"), 1, 1));
		this.addChild(
			new Text(`${keyHint("tui.select.confirm", "toggle / done")}  ${keyHint("tui.select.cancel", "cancel")}`, 1, 0),
		);
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.up")) {
			this.index = (this.index - 1 + this.rowCount) % this.rowCount;
		} else if (this.keybindings.matches(data, "tui.select.down")) {
			this.index = (this.index + 1) % this.rowCount;
		} else if (this.keybindings.matches(data, "tui.select.confirm")) {
			if (this.index === this.tools.length) {
				this.done([...this.selected]);
				return;
			}
			const name = this.tools[this.index].name;
			if (this.selected.has(name)) this.selected.delete(name);
			else this.selected.add(name);
		} else if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.done(undefined);
			return;
		} else {
			return;
		}
		this.rebuild();
		this.tui.requestRender();
	}
}

async function pickTools(ctx: ExtensionCommandContext, control: SubagentControl): Promise<string[] | undefined> {
	const tools = control.listTools();
	if (ctx.mode !== "tui") {
		const text = await ctx.ui.input(
			`Tools (comma-separated, empty = main agent's tools). Available: ${tools.map((tool) => tool.name).join(", ")}`,
		);
		if (text === undefined) return undefined;
		return text
			.split(",")
			.map((name) => name.trim())
			.filter(Boolean);
	}
	return ctx.ui.custom<string[] | undefined>(
		(tui, theme, keybindings, done) =>
			new ToolPickerComponent(tools, [], tui, theme, keybindings, done) as Component & { dispose?(): void },
	);
}

function writeAgentFile(path: string, type: Omit<AgentTypeDefinition, "source" | "filePath">): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, serializeAgentType(type), "utf-8");
}

async function createAgent(ctx: ExtensionCommandContext, control: SubagentControl): Promise<void> {
	const userOption = `User (${control.userAgentsDir})`;
	const projectOption = `Project (${control.projectAgentsDir})`;
	const scopes = control.isProjectTrusted() ? [projectOption, userOption] : [userOption];
	const scope = await ctx.ui.select("Where should the agent be saved?", scopes);
	if (!scope) return;
	const dir = scope === projectOption ? control.projectAgentsDir : control.userAgentsDir;

	const name = (await ctx.ui.input("Agent name", "for example: reviewer"))?.trim();
	if (!name) return;
	if (!isValidAgentTypeName(name)) {
		ctx.ui.notify("Agent names use letters, digits, `-`, `_`, and `.`", "error");
		return;
	}
	const path = join(dir, `${name}.md`);
	if (existsSync(path)) {
		ctx.ui.notify(`${path} already exists`, "error");
		return;
	}
	const description = (await ctx.ui.input("Description: when should the main agent use it?"))?.trim();
	if (!description) return;
	const tools = await pickTools(ctx, control);
	if (tools === undefined) return;
	const model = (await ctx.ui.input("Model (provider/model-id; empty = inherit)"))?.trim();
	if (model === undefined) return;
	const thinking = await ctx.ui.select("Thinking level", ["inherit", ...THINKING_LEVEL_OPTIONS]);
	if (!thinking) return;
	const systemPrompt = await ctx.ui.editor(
		`System prompt for ${name}`,
		`You are ${name}. ${description}\n\nDescribe how the agent works and what it reports back.`,
	);
	if (systemPrompt === undefined || !systemPrompt.trim()) return;

	writeAgentFile(path, {
		name,
		description,
		tools: tools.length > 0 ? tools : undefined,
		model: model || undefined,
		thinking: thinking === "inherit" ? undefined : THINKING_LEVEL_OPTIONS.find((level) => level === thinking),
		systemPrompt,
	});
	control.reload();
	ctx.ui.notify(`Created agent "${name}" at ${path}`, "info");
}

async function showAgentDetail(
	ctx: ExtensionCommandContext,
	control: SubagentControl,
	name: string,
): Promise<"back" | "close"> {
	while (true) {
		const type = control.listTypes().types.find((candidate) => candidate.name === name);
		if (!type) return "back";
		const editable = type.source !== "builtin" && type.filePath !== undefined;
		const actions = editable ? ["Edit system prompt", "Delete", "Back"] : ["Back"];
		const choice = await ctx.ui.select(formatAgentTypeDetail(type, control.resolveTools(type)), actions);
		if (choice === undefined) return "close";
		if (choice === "Back" || !type.filePath) return "back";
		if (choice === "Edit system prompt") {
			const systemPrompt = await ctx.ui.editor(`System prompt for ${type.name}`, type.systemPrompt);
			if (systemPrompt === undefined) continue;
			writeAgentFile(type.filePath, { ...type, systemPrompt });
			control.reload();
			ctx.ui.notify(`Updated ${type.filePath}`, "info");
		} else if (choice === "Delete") {
			if (!(await ctx.ui.confirm(`Delete agent "${type.name}"?`, type.filePath))) continue;
			unlinkSync(type.filePath);
			control.reload();
			ctx.ui.notify(`Deleted ${basename(type.filePath)}`, "info");
			return "back";
		}
	}
}

export async function showAgents(ctx: ExtensionCommandContext): Promise<void> {
	const control = ctx.subagents;
	if (!control) {
		ctx.ui.notify("Subagents are disabled (subagents.enabled)", "warning");
		return;
	}
	while (true) {
		const { types } = control.listTypes();
		const items = types.map((type) => formatAgentTypeItem(type, control.resolveTools(type)));
		const warnings = collectAgentWarnings(control, { includeMcp: true });
		const title = [`Agent types (${types.length})`, ...warnings.map((warning) => `⚠ ${warning}`)].join("\n");
		const choice = await ctx.ui.select(title, [...items, CREATE_ITEM]);
		if (choice === undefined) return;
		if (choice === CREATE_ITEM) {
			await createAgent(ctx, control);
			continue;
		}
		const type = types[items.indexOf(choice)];
		if (type && (await showAgentDetail(ctx, control, type.name)) === "close") return;
	}
}

/** Show each agent definition warning once per process. */
export function notifyAgentWarnings(ctx: ExtensionContext, shown: Set<string>): void {
	const control = ctx.subagents;
	if (!control || !ctx.hasUI) return;
	for (const warning of collectAgentWarnings(control)) {
		if (shown.has(warning)) continue;
		shown.add(warning);
		ctx.ui.notify(warning, "warning");
	}
}
