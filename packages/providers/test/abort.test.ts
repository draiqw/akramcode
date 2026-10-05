import type { Api, Context, Model, StreamOptions } from "@akramcode/ai/types";
import { describe, expect, it } from "vitest";
import { complete, getModel, stream } from "../src/compat.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

import { resolveApiKey } from "./oauth.ts";

// Resolve OAuth tokens at module level (async, runs before tests)
const [openaiCodexToken] = await Promise.all([resolveApiKey("openai-codex")]);

async function testAbortSignal<TApi extends Api>(llm: Model<TApi>, options: StreamOptionsWithExtras = {}) {
	const context: Context = {
		messages: [
			{
				role: "user",
				content: "What is 15 + 27? Think step by step. Then list 50 first names.",
				timestamp: Date.now(),
			},
		],
		systemPrompt: "You are a helpful assistant.",
	};

	let abortFired = false;
	let text = "";
	const controller = new AbortController();
	const response = await stream(llm, context, { ...options, signal: controller.signal });
	for await (const event of response) {
		if (abortFired) return;
		if (event.type === "text_delta" || event.type === "thinking_delta") {
			text += event.delta;
		}
		if (text.length >= 50) {
			controller.abort();
			abortFired = true;
		}
	}
	const msg = await response.result();

	// If we get here without throwing, the abort didn't work
	expect(msg.stopReason).toBe("aborted");
	expect(msg.content.length).toBeGreaterThan(0);

	context.messages.push(msg);
	context.messages.push({
		role: "user",
		content: "Please continue, but only generate 5 names.",
		timestamp: Date.now(),
	});

	const followUp = await complete(llm, context, options);
	expect(followUp.stopReason).toBe("stop");
	expect(followUp.content.length).toBeGreaterThan(0);
}

async function testImmediateAbort<TApi extends Api>(llm: Model<TApi>, options: StreamOptionsWithExtras = {}) {
	const controller = new AbortController();

	controller.abort();

	const context: Context = {
		messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
	};

	const response = await complete(llm, context, { ...options, signal: controller.signal });
	expect(response.stopReason).toBe("aborted");
}

async function _testAbortThenNewMessage<TApi extends Api>(llm: Model<TApi>, options: StreamOptionsWithExtras = {}) {
	// First request: abort immediately before any response content arrives
	const controller = new AbortController();
	controller.abort();

	const context: Context = {
		messages: [{ role: "user", content: "Hello, how are you?", timestamp: Date.now() }],
	};

	const abortedResponse = await complete(llm, context, { ...options, signal: controller.signal });
	expect(abortedResponse.stopReason).toBe("aborted");
	// The aborted message has empty content since we aborted before anything arrived
	expect(abortedResponse.content.length).toBe(0);

	// Add the aborted assistant message to context (this is what happens in the real coding agent)
	context.messages.push(abortedResponse);

	// Second request: send a new message - this should work even with the aborted message in context
	context.messages.push({
		role: "user",
		content: "What is 2 + 2?",
		timestamp: Date.now(),
	});

	const followUp = await complete(llm, context, options);
	expect(followUp.stopReason).toBe("stop");
	expect(followUp.content.length).toBeGreaterThan(0);
}

describe("AI Providers Abort Tests", () => {
	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Completions Provider Abort", () => {
		const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
		void _compat;
		const llm: Model<"openai-completions"> = {
			...baseModel,
			api: "openai-completions",
		};

		it("should abort mid-stream", { retry: 3 }, async () => {
			await testAbortSignal(llm);
		});

		it("should handle immediate abort", { retry: 3 }, async () => {
			await testImmediateAbort(llm);
		});
	});

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Responses Provider Abort", () => {
		const llm = getModel("openai", "gpt-5-mini");

		it("should abort mid-stream", { retry: 3 }, async () => {
			await testAbortSignal(llm);
		});

		it("should handle immediate abort", { retry: 3 }, async () => {
			await testImmediateAbort(llm);
		});
	});

	describe("OpenAI Codex Provider Abort", () => {
		it.skipIf(!openaiCodexToken)("should abort mid-stream", { retry: 3 }, async () => {
			const llm = getModel("openai-codex", "gpt-5.5");
			await testAbortSignal(llm, { apiKey: openaiCodexToken });
		});

		it.skipIf(!openaiCodexToken)("should handle immediate abort", { retry: 3 }, async () => {
			const llm = getModel("openai-codex", "gpt-5.5");
			await testImmediateAbort(llm, { apiKey: openaiCodexToken });
		});
	});
});
