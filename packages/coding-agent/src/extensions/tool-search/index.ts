/**
 * The `tool_search` tool as an extension. The CLI loads it as a built-in extension; SDK users add
 * `createToolSearchExtension()` to their extension factories.
 *
 * `tool_search` is registered inactive. Activate it with `--tools`, the `defaultTools` setting, or
 * `setActiveTools()`. The MCP extension activates it for `deferred` servers; skills alone do not,
 * since the system prompt already lists them.
 */

import type { ExtensionFactory } from "../../core/extensions/types.ts";
import { createToolSearchToolDefinition } from "./tool.ts";

export function createToolSearchExtension(): ExtensionFactory {
	return (akramcode) => {
		akramcode.registerTool({
			...createToolSearchToolDefinition({ tools: akramcode, skills: akramcode }),
			defaultActive: false,
		});
	};
}

export default createToolSearchExtension();
