import type { SourceInfo } from "./source-info.ts";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
	argumentHint?: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model and thinking level", argumentHint: "<provider/model>" },
	{
		name: "share",
		description: "Share session as a secret GitHub gist, or export it to HTML or JSONL",
		argumentHint: "<path>",
	},
	{ name: "remote", description: "Open this session in a browser on another computer", argumentHint: "<stop>" },
	{ name: "bug", description: "Report a bug to the AkramCode developers", argumentHint: "<description>" },
	{ name: "rename", description: "Rename the session", argumentHint: "<name>" },
	{ name: "skills", description: "Run a skill", argumentHint: "<skill>" },
	{ name: "usage", description: "Show session and all-time token usage, cost, and activity" },
	{ name: "stack", description: "Show loaded skills, agents, extensions, MCP, commands, tools, and context" },
	{ name: "fork", description: "Create a new fork from a previous user message" },
	{ name: "login", description: "Configure provider authentication", argumentHint: "<provider>" },
	{ name: "logout", description: "Remove provider authentication" },
	{ name: "clear", description: "Start a new session" },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, themes, and context files" },
	{ name: "quit", description: "Exit AkramCode" },
];
