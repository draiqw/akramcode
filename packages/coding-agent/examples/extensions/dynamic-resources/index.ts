import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@akramcode/coding-agent";

const baseDir = dirname(fileURLToPath(import.meta.url));

export default function (akramcode: ExtensionAPI) {
	akramcode.on("resources_discover", () => {
		return {
			skillPaths: [join(baseDir, "SKILL.md")],
			promptPaths: [join(baseDir, "dynamic.md")],
			themePaths: [join(baseDir, "dynamic.json")],
		};
	});
}
