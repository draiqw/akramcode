/**
 * Bash Spawn Hook Example
 *
 * Adjusts command, cwd, and env before execution.
 *
 * Usage:
 *   akramcode -e ./bash-spawn-hook.ts
 */

import type { ExtensionAPI } from "@akramcode/coding-agent";
import { createBashTool } from "@akramcode/coding-agent";

export default function (akramcode: ExtensionAPI) {
	const cwd = process.cwd();

	const bashTool = createBashTool(cwd, {
		spawnHook: ({ command, cwd, env }) => ({
			command: `source ~/.profile\n${command}`,
			cwd,
			env: { ...env, AKRAMCODE_SPAWN_HOOK: "1" },
		}),
	});

	akramcode.registerTool({
		...bashTool,
		execute: async (id, params, signal, onUpdate, _ctx) => {
			return bashTool.execute(id, params, signal, onUpdate);
		},
	});
}
