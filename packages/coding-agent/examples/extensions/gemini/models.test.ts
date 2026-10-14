import { createHash } from "node:crypto";
import type { ModelsPublication, ModelsStoreEntry } from "@akramcode/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshModels } from "./index.ts";
import {
	FALLBACK_MODELS,
	getModelEnum,
	modelsFromCatalog,
	restoreModelEnums,
	snapshotModelEnums,
} from "./models/models.ts";

afterEach(() => {
	vi.unstubAllGlobals();
	restoreModelEnums({});
});

// Regression coverage for draiqw/akramcode#5: discover subscription models from the account catalog.
describe("Gemini account model catalog", () => {
	it("keeps a bootstrap model so a fresh installation can offer login", () => {
		expect(FALLBACK_MODELS.length).toBeGreaterThan(0);
		expect(FALLBACK_MODELS[0]?.name).toMatch(/sign in/i);
	});

	it("uses the exact account model IDs without adding aliases or bootstrap entries", () => {
		const models = modelsFromCatalog({
			"gemini-3.8-flash-custom": { displayName: "Account Flash", supportsThinking: true, supportsImages: true },
			"claude-sonnet-4.6-account": { displayName: "Account Sonnet" },
			"gpt-oss-120b-medium": { displayName: "Account GPT" },
			"gemini-internal": { isInternal: true },
			"gemini-3.8-pro-image": { supportsImages: true },
			"unrelated-service": {},
		});
		expect(models.map((model) => model.id)).toEqual([
			"claude-sonnet-4.6-account",
			"gemini-3.8-flash-custom",
			"gpt-oss-120b-medium",
		]);
		expect(models.find((model) => model.id === "gemini-3.8-flash-custom")).toMatchObject({
			name: "Account Flash",
			reasoning: true,
			input: ["text", "image"],
		});
		expect(modelsFromCatalog({})).toEqual([]);
	});

	it("hydrates runtime model enums from an offline catalog after restarting", async () => {
		const cached = {
			models: [],
			checkedAt: Date.now(),
			modelEnums: { "gemini-account-low": "MODEL_ACCOUNT_LOW" },
			accountScope: createHash("sha256").update("mock-project").digest("hex"),
		};
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		expect(getModelEnum("gemini-account-low")).toBeUndefined();
		const publish = vi.fn(async (publication: ModelsPublication) => {
			publication.update?.();
			return true;
		});
		await refreshModels({
			stored: cached,
			allowNetwork: false,
			signal: new AbortController().signal,
			publish,
			credential: {
				type: "oauth",
				access: "mock-access",
				refresh: "mock-refresh",
				expires: 0,
				projectId: "mock-project",
			},
		});
		expect(getModelEnum("gemini-account-low")).toBe("MODEL_ACCOUNT_LOW");
		expect(fetch).not.toHaveBeenCalled();
		expect(snapshotModelEnums()).toEqual(cached.modelEnums);
	});

	it("forces discovery for a fresh catalog and persists only validated model enums", async () => {
		const fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						models: {
							"gemini-account-low": { model: "MODEL_ACCOUNT_LOW", modelExperiments: ["private-experiment"] },
							"gemini-account-other": { model: { secret: "not-an-enum" } },
							"gemini-account-invalid": { model: "private experiment name" },
							"gemini-account-image": { model: "MODEL_IMAGE" },
						},
					}),
				),
		);
		vi.stubGlobal("fetch", fetch);
		const publish = vi.fn(async (publication: ModelsPublication) => {
			publication.update?.();
			return true;
		});
		await refreshModels({
			stored: { models: [], checkedAt: Date.now() },
			allowNetwork: true,
			force: true,
			credential: {
				type: "oauth",
				access: "mock-access",
				refresh: "mock-refresh",
				expires: Date.now() + 3600000,
				projectId: "mock-project",
			},
			signal: new AbortController().signal,
			publish,
		});
		expect(fetch).toHaveBeenCalled();
		const publication = publish.mock.calls.find(([value]) => value.persist)?.[0];
		expect(publication?.persist).toMatchObject({ modelEnums: { "gemini-account-low": "MODEL_ACCOUNT_LOW" } });
		expect(JSON.stringify(publication?.persist)).not.toMatch(/private-experiment|modelExperiments|not-an-enum/);
		expect(snapshotModelEnums()).toEqual({ "gemini-account-low": "MODEL_ACCOUNT_LOW" });
	});

	it("discovers a new account despite a fresh previous account catalog", async () => {
		let currentProject = "old-project";
		const fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						models:
							currentProject === "old-project"
								? { "gemini-old-account": { model: "MODEL_OLD_ACCOUNT" } }
								: { "gemini-new-account": { model: "MODEL_NEW_ACCOUNT" } },
					}),
				),
		);
		vi.stubGlobal("fetch", fetch);
		let stored: ModelsStoreEntry | undefined;
		const publish = async (publication: ModelsPublication) => {
			if (publication.persist) stored = publication.persist;
			publication.update?.();
			return true;
		};
		const credential = {
			type: "oauth" as const,
			access: "mock-access",
			refresh: "mock-refresh",
			expires: Date.now() + 3600000,
		};
		await refreshModels({
			allowNetwork: true,
			publish,
			signal: new AbortController().signal,
			credential: { ...credential, projectId: currentProject },
		});
		expect(stored?.models.map((model) => model.id)).toEqual(["gemini-old-account"]);
		expect(getModelEnum("gemini-old-account")).toBe("MODEL_OLD_ACCOUNT");
		fetch.mockClear();
		currentProject = "new-project";
		const models = await refreshModels({
			stored,
			allowNetwork: true,
			publish,
			signal: new AbortController().signal,
			credential: { ...credential, projectId: currentProject },
		});
		expect(fetch).toHaveBeenCalled();
		expect(models.map((model) => model.id)).toEqual(["gemini-new-account"]);
		expect(stored?.models.map((model) => model.id)).toEqual(["gemini-new-account"]);
		expect(snapshotModelEnums()).toEqual({ "gemini-new-account": "MODEL_NEW_ACCOUNT" });
	});
});
