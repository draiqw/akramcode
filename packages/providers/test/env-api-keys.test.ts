import { describe, expect, it } from "vitest";
import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";

describe("environment API keys", () => {
	it("resolves a built-in provider key from its environment variable", () => {
		const env = { OPENAI_API_KEY: "sk-test" };
		expect(findEnvKeys("openai", env)).toEqual(["OPENAI_API_KEY"]);
		expect(getEnvApiKey("openai", env)).toBe("sk-test");
	});

	it("reports nothing when the variable is unset", () => {
		expect(findEnvKeys("deepseek", {})).toBeUndefined();
		expect(getEnvApiKey("deepseek", {})).toBeUndefined();
	});

	it("does not guess variables for providers it does not know", () => {
		const env = { SOMETHING_API_KEY: "x" };
		expect(findEnvKeys("something", env)).toBeUndefined();
	});
});
