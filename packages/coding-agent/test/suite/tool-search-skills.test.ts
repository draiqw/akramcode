import { fauxAssistantMessage, fauxToolCall } from "@akramcode/providers";
import { afterEach, describe, expect, it } from "vitest";
import type { Skill } from "../../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import { createToolSearchExtension } from "../../src/extensions/tool-search/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, getMessageText, getToolResult, type Harness } from "./harness.ts";

function skill(name: string, description: string, disableModelInvocation = false): Skill {
	return {
		name,
		description,
		filePath: `/skills/${name}/SKILL.md`,
		baseDir: `/skills/${name}`,
		sourceInfo: createSyntheticSourceInfo(`/skills/${name}/SKILL.md`, { source: "test" }),
		disableModelInvocation,
	};
}

describe("tool_search over session skills", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("finds model-invocable skills of the session without activating them", async () => {
		const skills = [skill("pdf-tools", "Extract text from PDF files."), skill("pdf-hidden", "PDF internals.", true)];
		const extensionsResult = await createTestExtensionsResult([createToolSearchExtension()]);
		const harness = await createHarness({
			initialActiveToolNames: ["tool_search"],
			resourceLoader: {
				...createTestResourceLoader({ extensionsResult }),
				getSkills: () => ({ skills, diagnostics: [] }),
			},
		});
		harnesses.push(harness);
		await harness.session.bindExtensions({});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("tool_search", { query: "pdf" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("find a pdf skill");

		expect(getMessageText(getToolResult(harness, "tool_search"))).toBe(
			"To use a skill, read its file:\n- skill:pdf-tools: Extract text from PDF files. (/skills/pdf-tools/SKILL.md)",
		);
		expect(harness.session.getActiveToolNames()).toEqual(["tool_search"]);
	});
});
