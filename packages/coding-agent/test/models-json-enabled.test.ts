import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";

async function createRuntime(modelsJson: unknown) {
	const dir = mkdtempSync(join(tmpdir(), "akramcode-enabled-"));
	const path = join(dir, "models.json");
	writeFileSync(path, JSON.stringify(modelsJson));
	const authStorage = AuthStorage.inMemory({
		openai: { type: "api_key", key: "test-key" },
		openrouter: { type: "api_key", key: "test-key" },
	});
	return getModelRuntime(await createModelRegistry(authStorage, path));
}

describe("models.json enabled flags", () => {
	it("removes a disabled built-in provider from the registry", async () => {
		const runtime = await createRuntime({ providers: { openrouter: { enabled: false } } });
		const ids = runtime.getProviders().map((provider) => provider.id);
		expect(ids).not.toContain("openrouter");
		expect(ids).toContain("openai");
		expect((await runtime.getAvailable()).some((model) => model.provider === "openrouter")).toBe(false);
	});

	it("keeps a provider whose only setting is enabled: true", async () => {
		const runtime = await createRuntime({ providers: { openai: { enabled: true } } });
		expect(runtime.getProviders().map((provider) => provider.id)).toContain("openai");
	});

	it("hides a single built-in model through a model override", async () => {
		const runtime = await createRuntime({
			providers: { openai: { modelOverrides: { "gpt-5": { enabled: false } } } },
		});
		const ids = (await runtime.getAvailable())
			.filter((model) => model.provider === "openai")
			.map((model) => model.id);
		expect(ids).not.toContain("gpt-5");
		expect(ids.length).toBeGreaterThan(1);
	});

	it("skips a custom model marked disabled", async () => {
		const runtime = await createRuntime({
			providers: {
				local: {
					baseUrl: "http://localhost:8000/v1",
					api: "openai-completions",
					apiKey: "local",
					models: [{ id: "on" }, { id: "off", enabled: false }],
				},
			},
		});
		const ids = (await runtime.getAvailable()).filter((model) => model.provider === "local").map((model) => model.id);
		expect(ids).toEqual(["on"]);
	});
});
