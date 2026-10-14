import { describe, expect, it } from "vitest";
import { createEventBus } from "../src/core/event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import type { ExtensionAgentType } from "../src/core/extensions/types.ts";

/** The error `registerAgentType` throws for `type`, or undefined when it registers. */
async function registerError(type: unknown): Promise<string | undefined> {
	const runtime = createExtensionRuntime();
	let error: string | undefined;
	await loadExtensionFromFactory(
		(akramcode) => {
			try {
				akramcode.registerAgentType(type as ExtensionAgentType);
			} catch (caught) {
				error = caught instanceof Error ? caught.message : String(caught);
			}
		},
		process.cwd(),
		createEventBus(),
		runtime,
	);
	return error;
}

const valid = { name: "docs", description: "Docs lookups", systemPrompt: "Answer from the docs." };

describe("registerAgentType", () => {
	it("registers a valid type", async () => {
		expect(await registerError({ ...valid, tools: ["mcp__docs__*"], thinking: "low" })).toBeUndefined();
	});

	it("rejects names that agent files cannot have", async () => {
		for (const name of [".x", "-x", ".."]) {
			expect(await registerError({ ...valid, name })).toMatch(/Invalid agent type name/);
		}
	});

	it("rejects tool lists that are not string arrays", async () => {
		expect(await registerError({ ...valid, tools: "mcp__docs__*" })).toMatch(/tools must be an array of strings/);
		expect(await registerError({ ...valid, disallowedTools: [1] })).toMatch(/disallowedTools must be an array/);
	});

	it("rejects unknown thinking levels", async () => {
		expect(await registerError({ ...valid, thinking: "extreme" })).toMatch(/thinking must be one of/);
	});
});
