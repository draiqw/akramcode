import type { InlineExtension } from "../core/extensions/types.ts";
import codemodeExtension from "./codemode/index.ts";
import llamaExtension from "./llama/index.ts";
import mcpExtension from "./mcp/index.ts";
import onlineCompactExtension from "./online-compact/index.ts";
import questionExtension from "./question/index.ts";
import tasksExtension from "./tasks/index.ts";
import toolSearchExtension from "./tool-search/index.ts";
import workflowsExtension from "./workflows/index.ts";

export const builtInExtensions: InlineExtension[] = [
	{ name: "llama.cpp", factory: llamaExtension, builtin: true },
	// Replaceable: an extension that registers `codemode`, `tool_search`, or `/mcp` (such as a third-party
	// MCP extension) takes over instead of running alongside the built-in one.
	{ name: "codemode", factory: codemodeExtension, replaceable: true, builtin: true },
	{ name: "tool-search", factory: toolSearchExtension, replaceable: true, builtin: true },
	{ name: "mcp", factory: mcpExtension, replaceable: true, builtin: true },
	// Inert until `update_plan` is activated (`"defaultTools": ["+update_plan"]`).
	{ name: "online-compact", factory: onlineCompactExtension, replaceable: true, builtin: true },
	// Footer status, `/tasks`, `/agents`, and the chat rendering of task notifications.
	{ name: "tasks", factory: tasksExtension, replaceable: true, builtin: true },
	// Replaceable: an extension that registers its own `question` tool takes over.
	{ name: "question", factory: questionExtension, replaceable: true, builtin: true },
	// `/workflow` and the `workflow_run` tool. Replaceable: an extension that registers either takes over.
	{ name: "workflows", factory: workflowsExtension, replaceable: true, builtin: true },
];
