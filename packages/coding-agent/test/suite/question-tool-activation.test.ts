import { afterEach, describe, expect, it } from "vitest";
import { createQuestionExtension } from "../../src/extensions/question/index.ts";
import { createHarness, createTestUiContext, type Harness } from "./harness.ts";

describe("question tool activation", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	const setup = async () => {
		const harness = await createHarness({
			extensionFactories: [createQuestionExtension()],
			initialActiveToolNames: ["read", "question"],
		});
		harnesses.push(harness);
		return harness;
	};

	it("drops the question tool without a UI, as in print and JSON modes", async () => {
		const harness = await setup();
		await harness.session.bindExtensions({});

		expect(harness.session.getActiveToolNames()).toEqual(["read"]);
	});

	it("keeps the question tool with a UI", async () => {
		const harness = await setup();
		await harness.session.bindExtensions({ uiContext: createTestUiContext() });

		expect(harness.session.getActiveToolNames()).toContain("question");
	});
});
