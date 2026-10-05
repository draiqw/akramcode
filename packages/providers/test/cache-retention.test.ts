import type { Model } from "@akramcode/ai/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import { stream as streamOpenAIResponses } from "../src/api/openai-responses.ts";
import { getModel, normalizeContext, stream } from "../src/compat.ts";

class PayloadCaptured extends Error {
	constructor() {
		super("payload captured");
		this.name = "PayloadCaptured";
	}
}

interface OpenAICompletionsCachePayload {
	prompt_cache_key?: string;
	prompt_cache_retention?: string;
}

interface OpenAIResponsesCachePayload extends OpenAICompletionsCachePayload {
	prompt_cache_options?: { mode?: "explicit"; ttl?: "30m" };
}

function stopAfterPayload<TPayload>(capture: (payload: TPayload) => void): (payload: unknown) => never {
	return (payload: unknown): never => {
		capture(payload as TPayload);
		throw new PayloadCaptured();
	};
}

describe("Cache Retention (AKRAMCODE_CACHE_RETENTION)", () => {
	const originalEnv = process.env.AKRAMCODE_CACHE_RETENTION;

	beforeEach(() => {
		delete process.env.AKRAMCODE_CACHE_RETENTION;
	});

	afterEach(() => {
		if (originalEnv !== undefined) {
			process.env.AKRAMCODE_CACHE_RETENTION = originalEnv;
		} else {
			delete process.env.AKRAMCODE_CACHE_RETENTION;
		}
	});

	const context = normalizeContext({
		systemPrompt: "You are a helpful assistant.",
		messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
	});

	describe("OpenAI Responses Provider", () => {
		it.each(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-astra", "gpt-6-luna", "gpt-6-sol"] as const)(
			"does not enable cache warming from the documented TTL alone for %s",
			(modelId) => {
				expect(getModel("openai", modelId).promptCache).toBeUndefined();
			},
		);

		it.skipIf(!process.env.OPENAI_API_KEY)(
			"should not set prompt_cache_retention when AKRAMCODE_CACHE_RETENTION is not set",
			async () => {
				const model = getModel("openai", "gpt-4o-mini");
				let capturedPayload: any = null;

				const s = stream(model, context, {
					onPayload: stopAfterPayload((payload) => {
						capturedPayload = payload;
					}),
				});

				// Consume the stream to trigger the request
				for await (const _ of s) {
					// Just consume
				}

				expect(capturedPayload).not.toBeNull();
				expect(capturedPayload.prompt_cache_retention).toBeUndefined();
			},
		);

		it.skipIf(!process.env.OPENAI_API_KEY)(
			"should set prompt_cache_retention to 24h when AKRAMCODE_CACHE_RETENTION=long",
			async () => {
				process.env.AKRAMCODE_CACHE_RETENTION = "long";
				const model = getModel("openai", "gpt-4o-mini");
				let capturedPayload: any = null;

				const s = stream(model, context, {
					onPayload: stopAfterPayload((payload) => {
						capturedPayload = payload;
					}),
				});

				// Consume the stream to trigger the request
				for await (const _ of s) {
					// Just consume
				}

				expect(capturedPayload).not.toBeNull();
				expect(capturedPayload.prompt_cache_retention).toBe("24h");
			},
		);

		it("should set prompt_cache_retention for non-api.openai.com baseUrl by default", async () => {
			process.env.AKRAMCODE_CACHE_RETENTION = "long";

			// Create a model with a different baseUrl (simulating a proxy)
			const baseModel = getModel("openai", "gpt-4o-mini");
			const proxyModel = {
				...baseModel,
				baseUrl: "https://my-proxy.example.com/v1",
			};

			let capturedPayload: any = null;

			try {
				const s = streamOpenAIResponses(proxyModel, context, {
					apiKey: "sk-fake-key",
					onPayload: stopAfterPayload((payload) => {
						capturedPayload = payload;
					}),
				});

				// This will fail since we're using a fake key and fake proxy, but the payload should be captured
				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			expect(capturedPayload).not.toBeNull();
			expect(capturedPayload.prompt_cache_retention).toBe("24h");
		});

		it("should omit prompt_cache_retention when supportsLongCacheRetention is false", async () => {
			const model = {
				...getModel("openai", "gpt-4o-mini"),
				compat: { supportsLongCacheRetention: false },
			};
			let capturedPayload: any = null;

			try {
				const s = streamOpenAIResponses(model, context, {
					apiKey: "sk-fake-key",
					cacheRetention: "long",
					sessionId: "session-compat-false",
					onPayload: stopAfterPayload((payload) => {
						capturedPayload = payload;
					}),
				});

				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			expect(capturedPayload).not.toBeNull();
			expect(capturedPayload.prompt_cache_retention).toBeUndefined();
		});

		it("should omit prompt_cache_key and disable implicit writes when cacheRetention is none", async () => {
			const model = getModel("openai", "gpt-5.6-sol");
			let capturedPayload: OpenAIResponsesCachePayload | undefined;

			try {
				const s = streamOpenAIResponses(model, context, {
					apiKey: "sk-fake-key",
					cacheRetention: "none",
					sessionId: "session-1",
					onPayload: stopAfterPayload<OpenAIResponsesCachePayload>((payload) => {
						capturedPayload = payload;
					}),
				});

				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			expect(capturedPayload).toBeDefined();
			expect(capturedPayload?.prompt_cache_key).toBeUndefined();
			expect(capturedPayload?.prompt_cache_retention).toBeUndefined();
			expect(capturedPayload?.prompt_cache_options).toEqual({ mode: "explicit" });
		});

		it("should omit prompt_cache_options for models that reject it", async () => {
			const model = getModel("openai", "gpt-4o-mini");
			let capturedPayload: OpenAIResponsesCachePayload | undefined;

			try {
				const s = streamOpenAIResponses(model, context, {
					apiKey: "sk-fake-key",
					cacheRetention: "none",
					sessionId: "session-1",
					onPayload: stopAfterPayload<OpenAIResponsesCachePayload>((payload) => {
						capturedPayload = payload;
					}),
				});

				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			expect(capturedPayload).toBeDefined();
			expect(capturedPayload?.prompt_cache_key).toBeUndefined();
			expect(capturedPayload?.prompt_cache_options).toBeUndefined();
		});

		it.each([
			["gpt-4o-mini", "24h", undefined],
			["gpt-6-astra", undefined, { ttl: "30m" }],
			["gpt-6-sol", undefined, { ttl: "30m" }],
			["gpt-6-luna", undefined, { ttl: "30m" }],
		] as const)("should use the supported long cache field for %s", async (modelId, retention, cacheOptions) => {
			const model = getModel("openai", modelId);
			let capturedPayload: OpenAIResponsesCachePayload | undefined;

			try {
				const s = streamOpenAIResponses(model, context, {
					apiKey: "sk-fake-key",
					cacheRetention: "long",
					sessionId: "session-2",
					onPayload: stopAfterPayload<OpenAIResponsesCachePayload>((payload) => {
						capturedPayload = payload;
					}),
				});

				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			expect(capturedPayload?.prompt_cache_key).toBe("session-2");
			expect(capturedPayload?.prompt_cache_retention).toBe(retention);
			expect(capturedPayload?.prompt_cache_options).toEqual(cacheOptions);
		});
	});

	describe("OpenAI Completions Provider", () => {
		function createCompletionsModel(compat?: Model<"openai-completions">["compat"]): Model<"openai-completions"> {
			return {
				id: "test-model",
				name: "Test Model",
				api: "openai-completions",
				provider: "test-openai-completions",
				baseUrl: "https://my-proxy.example.com/v1",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
				compat,
			};
		}

		it("should set prompt_cache_retention for non-api.openai.com baseUrl by default", async () => {
			let capturedPayload: any = null;

			try {
				const s = streamOpenAICompletions(createCompletionsModel(), context, {
					apiKey: "fake-key",
					cacheRetention: "long",
					sessionId: "session-completions",
					onPayload: stopAfterPayload((payload) => {
						capturedPayload = payload;
					}),
				});

				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			expect(capturedPayload).not.toBeNull();
			expect(capturedPayload.prompt_cache_key).toBe("session-completions");
			expect(capturedPayload.prompt_cache_retention).toBe("24h");
		});

		it("should omit prompt_cache_retention when supportsLongCacheRetention is false", async () => {
			let capturedPayload: any = null;

			try {
				const s = streamOpenAICompletions(createCompletionsModel({ supportsLongCacheRetention: false }), context, {
					apiKey: "fake-key",
					cacheRetention: "long",
					sessionId: "session-completions-false",
					onPayload: stopAfterPayload((payload) => {
						capturedPayload = payload;
					}),
				});

				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			expect(capturedPayload).not.toBeNull();
			expect(capturedPayload.prompt_cache_key).toBeUndefined();
			expect(capturedPayload.prompt_cache_retention).toBeUndefined();
		});
	});
});
