/**
 * Test context overflow error handling across providers.
 *
 * Context overflow occurs when the input (prompt + history) exceeds
 * the model's context window. This is different from output token limits.
 *
 * Expected behavior: All providers should return stopReason: "error"
 * with an errorMessage that indicates the context was too large,
 * OR (for z.ai) return successfully with usage.input > contextWindow.
 *
 * The isContextOverflow() function must return true for all providers.
 */

import type { AssistantMessage, Context, Model, Usage } from "@akramcode/ai/types";
import { isContextOverflow } from "@akramcode/ai/utils/overflow";
import { execSync } from "child_process";
import { describe, expect, it } from "vitest";
import { complete, getModel } from "../src/compat.ts";
import { resolveApiKey } from "./oauth.ts";

// Resolve OAuth tokens at module level (async, runs before tests)
const oauthTokens = await Promise.all([resolveApiKey("github-copilot"), resolveApiKey("openai-codex")]);
const [_githubCopilotToken, openaiCodexToken] = oauthTokens;

// Lorem ipsum paragraph for realistic token estimation
const LOREM_IPSUM = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. `;

// Generate a string that will exceed the context window
// Using chars/4 as token estimate (works better with varied text than repeated chars)
function generateOverflowContent(contextWindow: number): string {
	const targetTokens = contextWindow + 10000; // Exceed by 10k tokens
	const targetChars = targetTokens * 4 * 1.5;
	const repetitions = Math.ceil(targetChars / LOREM_IPSUM.length);
	return LOREM_IPSUM.repeat(repetitions);
}

interface OverflowResult {
	provider: string;
	model: string;
	contextWindow: number;
	stopReason: string;
	errorMessage: string | undefined;
	usage: Usage;
	hasUsageData: boolean;
	response: AssistantMessage;
}

async function testContextOverflow(model: Model<any>, apiKey: string): Promise<OverflowResult> {
	const overflowContent = generateOverflowContent(model.contextWindow);

	const context: Context = {
		systemPrompt: "You are a helpful assistant.",
		messages: [
			{
				role: "user",
				content: overflowContent,
				timestamp: Date.now(),
			},
		],
	};

	const response = await complete(model, context, { apiKey });

	const hasUsageData = response.usage.input > 0 || response.usage.cacheRead > 0;

	return {
		provider: model.provider,
		model: model.id,
		contextWindow: model.contextWindow,
		stopReason: response.stopReason,
		errorMessage: response.errorMessage,
		usage: response.usage,
		hasUsageData,
		response,
	};
}

function logResult(result: OverflowResult) {
	console.log(`\n${result.provider} / ${result.model}:`);
	console.log(`  contextWindow: ${result.contextWindow}`);
	console.log(`  stopReason: ${result.stopReason}`);
	console.log(`  errorMessage: ${result.errorMessage}`);
	console.log(`  usage: ${JSON.stringify(result.usage)}`);
	console.log(`  hasUsageData: ${result.hasUsageData}`);
}

// =============================================================================
// Anthropic
// Expected pattern: "prompt is too long: X tokens > Y maximum"
// =============================================================================

describe("Context overflow error handling", () => {
	// =============================================================================
	// OpenAI
	// Expected pattern: "exceeds the context window"
	// =============================================================================

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Completions", () => {
		it("gpt-4o-mini - should detect overflow via isContextOverflow", async () => {
			const model = { ...getModel("openai", "gpt-4o-mini") };
			model.api = "openai-completions" as any;
			const result = await testContextOverflow(model, process.env.OPENAI_API_KEY!);
			logResult(result);

			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toMatch(/maximum context length/i);
			expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
		}, 120000);
	});

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Responses", () => {
		it("gpt-4o - should detect overflow via isContextOverflow", async () => {
			const model = getModel("openai", "gpt-4o");
			const result = await testContextOverflow(model, process.env.OPENAI_API_KEY!);
			logResult(result);

			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toMatch(/exceeds the context window/i);
			expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
		}, 120000);
	});

	// =============================================================================
	// Uses same API as Google, expects same error pattern
	// =============================================================================

	// =============================================================================
	// =============================================================================

	// =============================================================================
	// OpenAI Codex (OAuth)
	// Uses ChatGPT Plus/Pro subscription via OAuth
	// =============================================================================

	describe("OpenAI Codex (OAuth)", () => {
		it.skipIf(!openaiCodexToken)(
			"gpt-5.5 - should detect overflow via isContextOverflow",
			async () => {
				const model = getModel("openai-codex", "gpt-5.5");
				const result = await testContextOverflow(model, openaiCodexToken!);
				logResult(result);

				expect(result.stopReason).toBe("error");
				expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
			},
			120000,
		);
	});

	// =============================================================================
	// OpenRouter - Multiple backend providers
	// Expected pattern: "maximum context length is X tokens"
	// =============================================================================

	describe.skipIf(!process.env.OPENROUTER_API_KEY)("OpenRouter", () => {
		// Anthropic backend
		it("anthropic/claude-sonnet-4 via OpenRouter - should detect overflow via isContextOverflow", async () => {
			const model = getModel("openrouter", "anthropic/claude-sonnet-4");
			const result = await testContextOverflow(model, process.env.OPENROUTER_API_KEY!);
			logResult(result);

			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toMatch(/maximum context length is \d+ tokens/i);
			expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
		}, 120000);

		// DeepSeek backend
		it("deepseek/deepseek-v3.2 via OpenRouter - should detect overflow via isContextOverflow", async () => {
			const model = getModel("openrouter", "deepseek/deepseek-v3.2");
			const result = await testContextOverflow(model, process.env.OPENROUTER_API_KEY!);
			logResult(result);

			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toMatch(/maximum context length is \d+ tokens/i);
			expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
		}, 120000);

		// Mistral backend
		it("mistralai/mistral-large-2512 via OpenRouter - should detect overflow via isContextOverflow", async () => {
			const model = getModel("openrouter", "mistralai/mistral-large");
			const result = await testContextOverflow(model, process.env.OPENROUTER_API_KEY!);
			logResult(result);

			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toMatch(/maximum context length is \d+ tokens/i);
			expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
		}, 120000);

		// Google backend
		it("google/gemini-2.5-flash via OpenRouter - should detect overflow via isContextOverflow", async () => {
			const model = getModel("openrouter", "google/gemini-2.5-flash");
			const result = await testContextOverflow(model, process.env.OPENROUTER_API_KEY!);
			logResult(result);

			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toMatch(/maximum context length is \d+ tokens/i);
			expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
		}, 120000);

		// Meta/Llama backend
		it("meta-llama/llama-4-scout via OpenRouter - should detect overflow via isContextOverflow", async () => {
			const model = getModel("openrouter", "meta-llama/llama-4-scout");
			const result = await testContextOverflow(model, process.env.OPENROUTER_API_KEY!);
			logResult(result);

			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toMatch(/maximum context length is \d+ tokens/i);
			expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
		}, 120000);
	});

	// =============================================================================
	// LM Studio (local) - Skip if not running or local LLM tests disabled
	// =============================================================================

	let lmStudioRunning = false;
	if (!process.env.AKRAMCODE_NO_LOCAL_LLM) {
		try {
			execSync("curl -s --max-time 1 http://localhost:1234/v1/models > /dev/null", { stdio: "ignore" });
			lmStudioRunning = true;
		} catch {
			lmStudioRunning = false;
		}
	}

	describe.skipIf(!lmStudioRunning)("LM Studio (local)", () => {
		it("should detect overflow via isContextOverflow", async () => {
			const model: Model<"openai-completions"> = {
				id: "local-model",
				api: "openai-completions",
				provider: "lm-studio",
				baseUrl: "http://localhost:1234/v1",
				reasoning: false,
				input: ["text"],
				contextWindow: 8192,
				maxTokens: 2048,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				name: "LM Studio Local Model",
			};

			const result = await testContextOverflow(model, "lm-studio");
			logResult(result);

			expect(result.stopReason).toBe("error");
			expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
		}, 120000);
	});

	// =============================================================================
	// llama.cpp server (local) - Skip if not running or not exposing /v1/completions
	// =============================================================================

	let llamaCppRunning = false;
	if (!process.env.AKRAMCODE_NO_LOCAL_LLM) {
		try {
			execSync("curl -s --max-time 1 http://localhost:8081/health > /dev/null", { stdio: "ignore" });
			const probeStatus = execSync(
				'curl -s --max-time 1 -o /dev/null -w \'%{http_code}\' -X POST http://localhost:8081/v1/completions -H \'content-type: application/json\' -d \'{"model":"local-model","prompt":"ping","max_tokens":1}\'',
				{ encoding: "utf8" },
			).trim();
			llamaCppRunning = probeStatus !== "404" && probeStatus !== "405" && probeStatus !== "000";
		} catch {
			llamaCppRunning = false;
		}
	}

	describe.skipIf(!llamaCppRunning)("llama.cpp (local)", () => {
		it("should detect overflow via isContextOverflow", async () => {
			// Using small context (4096) to match server --ctx-size setting
			const model: Model<"openai-completions"> = {
				id: "local-model",
				api: "openai-completions",
				provider: "llama.cpp",
				baseUrl: "http://localhost:8081/v1",
				reasoning: false,
				input: ["text"],
				contextWindow: 4096,
				maxTokens: 2048,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				name: "llama.cpp Local Model",
			};

			const result = await testContextOverflow(model, "llama.cpp");
			logResult(result);

			expect(result.stopReason).toBe("error");
			expect(isContextOverflow(result.response, model.contextWindow)).toBe(true);
		}, 120000);
	});
});
