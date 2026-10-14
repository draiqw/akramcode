/**
 * The `codemode` tool as an extension. The CLI loads it as a built-in extension; SDK users
 * add `createCodemodeExtension()` to their extension factories.
 *
 * `codemode` is registered inactive. Activate it with `--tools`, the `defaultTools` setting, or
 * `setActiveTools()`; the MCP extension activates it when MCP tools are only reachable from scripts.
 */

import type { ExtensionAPI, ExtensionFactory } from "../../core/extensions/types.ts";
import type { CodemodeMode } from "../../core/settings-manager.ts";
import { createCodemodeToolDefinition } from "./tool.ts";

export interface CodemodeExtensionOptions {
	/** Overrides the `codemode.mode` setting. */
	mode?: CodemodeMode;
	/** Overrides the `codemode.inlineBudget` setting. */
	inlineBudget?: number;
	/** Expose the model catalog and classifiers to scripts as `models`. Default: `true`. */
	models?: boolean;
}

function readMode(akramcode: ExtensionAPI): CodemodeMode {
	return akramcode.getSettings().codemode?.mode === "only" ? "only" : "on";
}

function readInlineBudget(akramcode: ExtensionAPI): number | undefined {
	const budget = akramcode.getSettings().codemode?.inlineBudget;
	return typeof budget === "number" && Number.isFinite(budget) && budget >= 0 ? budget : undefined;
}

export function createCodemodeExtension(options: CodemodeExtensionOptions = {}): ExtensionFactory {
	return (akramcode) => {
		akramcode.registerTool({
			...createCodemodeToolDefinition({
				appendEntry: (customType, data) => akramcode.appendEntry(customType, data),
				models: options.models ?? true,
				getToolNamespace: (name) => akramcode.getAllTools().find((tool) => tool.name === name)?.namespace,
				getMode: () => options.mode ?? readMode(akramcode),
				getInlineBudget: () => options.inlineBudget ?? readInlineBudget(akramcode),
			}),
			defaultActive: false,
		});
	};
}

export default createCodemodeExtension();
