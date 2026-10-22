import { setKeybindings } from "@akramcode/tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { Skill } from "../src/core/skills.ts";
import { collectStack, type StackSources } from "../src/core/stack.ts";
import { StackViewerComponent } from "../src/modes/interactive/components/stack-viewer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const agentDir = "/home/u/.akramcode";
const cwd = "/repo";

function skill(name: string, scope: "user" | "project", disableModelInvocation = false): Skill {
	const dir = scope === "user" ? `${agentDir}/skills/${name}` : `${cwd}/.akramcode/skills/${name}`;
	return {
		name,
		description: `${name} skill`,
		filePath: `${dir}/SKILL.md`,
		baseDir: dir,
		sourceInfo: { path: `${dir}/SKILL.md`, source: "local", scope, origin: "top-level" },
		disableModelInvocation,
	};
}

function sources(): StackSources {
	return {
		agentDir,
		skills: {
			skills: [skill("pdf", "user"), skill("lint", "project"), skill("deploy-now", "user", true)],
			diagnostics: [
				{
					type: "collision",
					message: 'name "lint" collision',
					collision: {
						resourceType: "skill",
						name: "lint",
						winnerPath: `${cwd}/.akramcode/skills/lint/SKILL.md`,
						loserPath: `${agentDir}/skills/lint/SKILL.md`,
					},
				},
			],
		},
		prompts: { prompts: [], diagnostics: [] },
		extensions: [],
		resolvedPaths: {
			extensions: [],
			skills: [
				{
					path: `${agentDir}/skills/lint`,
					enabled: true,
					metadata: { source: "auto", scope: "user", origin: "top-level" },
				},
				{
					path: `${agentDir}/skills/deploy`,
					enabled: false,
					metadata: { source: "auto", scope: "user", origin: "top-level" },
				},
			],
			prompts: [],
			themes: [],
		},
		mcpServers: [],
		builtinCommands: [{ name: "stack", description: "Show the stack" }],
		extensionCommands: [],
		tools: [],
		activeToolNames: [],
		contextFiles: [{ path: `${cwd}/AGENTS.md`, content: "x".repeat(400) }],
		appendSystemPrompt: { paths: [], contents: [] },
	};
}

describe("/stack", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("lists active, manual, overridden, and disabled skills with their level", () => {
		const skills = collectStack(sources())[0];
		expect(skills.items.map((item) => [item.name, item.scope, item.status])).toEqual([
			["lint", "project", "active"],
			["pdf", "user", "active"],
			["deploy-now", "user", "manual"],
			["lint", "user", "overridden"],
			["deploy", "user", "disabled"],
		]);
		expect(skills.items.find((item) => item.status === "manual")?.tokens).toBeUndefined();
		expect(collectStack(sources())[6].items[0]).toMatchObject({ name: "AGENTS.md", scope: "project", tokens: 100 });
	});

	it("switches tabs and shows details", () => {
		const close = vi.fn();
		const viewer = new StackViewerComponent(collectStack(sources()), close, () => {});
		const render = () => viewer.render(70).map(stripAnsi).join("\n");

		expect(render()).toContain("→ ● lint");
		expect(render()).toContain("5 skills · ~56 tok in system prompt");
		viewer.getFocusTarget().handleInput?.("\r");
		expect(render()).toContain("lint skill");
		viewer.getFocusTarget().handleInput?.("\t");
		expect(render()).toContain("(none)");
		viewer.getFocusTarget().handleInput?.("\x1b");
		expect(close).toHaveBeenCalled();
	});
});
