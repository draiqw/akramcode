import type { Api, Context, ImageContent, Model, StreamOptions, Tool, ToolResultMessage } from "@akramcode/ai/types";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { Type } from "typebox";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { complete, getModel, stream } from "../src/compat.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

import { StringEnum } from "@akramcode/ai/utils/typebox-helpers";
import { resolveApiKey } from "./oauth.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve OAuth tokens at module level (async, runs before tests)
const oauthTokens = await Promise.all([resolveApiKey("anthropic"), resolveApiKey("openai-codex")]);
const [anthropicOAuthToken, openaiCodexToken] = oauthTokens;

// Calculator tool definition (same as examples)
// Note: Using StringEnum helper because Google's API doesn't support anyOf/const patterns
// that Type.Enum generates. Google requires { type: "string", enum: [...] } format.
const calculatorSchema = Type.Object({
	a: Type.Number({ description: "First number" }),
	b: Type.Number({ description: "Second number" }),
	operation: StringEnum(["add", "subtract", "multiply", "divide"], {
		description: "The operation to perform. One of 'add', 'subtract', 'multiply', 'divide'.",
	}),
});

const calculatorTool: Tool<typeof calculatorSchema> = {
	name: "math_operation",
	description: "Perform basic arithmetic operations",
	parameters: calculatorSchema,
};

async function basicTextGeneration<TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
	const context: Context = {
		systemPrompt: "You are a helpful assistant. Be concise.",
		messages: [{ role: "user", content: "Reply with exactly: 'Hello test successful'", timestamp: Date.now() }],
	};
	const response = await complete(model, context, options);

	expect(response.role).toBe("assistant");
	expect(response.content).toBeTruthy();
	expect(response.usage.input + response.usage.cacheRead).toBeGreaterThan(0);
	expect(response.usage.output).toBeGreaterThan(0);
	expect(response.errorMessage).toBeFalsy();
	expect(response.content.map((b) => (b.type === "text" ? b.text : "")).join("")).toContain("Hello test successful");

	context.messages.push(response);
	context.messages.push({ role: "user", content: "Now say 'Goodbye test successful'", timestamp: Date.now() });

	const secondResponse = await complete(model, context, options);

	expect(secondResponse.role).toBe("assistant");
	expect(secondResponse.content).toBeTruthy();
	expect(secondResponse.usage.input + secondResponse.usage.cacheRead).toBeGreaterThan(0);
	expect(secondResponse.usage.output).toBeGreaterThan(0);
	expect(secondResponse.errorMessage).toBeFalsy();
	expect(secondResponse.content.map((b) => (b.type === "text" ? b.text : "")).join("")).toContain(
		"Goodbye test successful",
	);
}

async function handleToolCall<TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
	const context: Context = {
		systemPrompt: "You are a helpful assistant that uses tools when asked.",
		messages: [
			{
				role: "user",
				content: "Calculate 15 + 27 using the math_operation tool.",
				timestamp: Date.now(),
			},
		],
		tools: [calculatorTool],
	};

	const s = await stream(model, context, options);
	let hasToolStart = false;
	let hasToolDelta = false;
	let hasToolEnd = false;
	let accumulatedToolArgs = "";
	let index = 0;
	for await (const event of s) {
		if (event.type === "toolcall_start") {
			hasToolStart = true;
			const toolCall = event.partial.content[event.contentIndex];
			index = event.contentIndex;
			expect(toolCall.type).toBe("toolCall");
			if (toolCall.type === "toolCall") {
				expect(toolCall.name).toBe("math_operation");
				expect(toolCall.id).toBeTruthy();
			}
		}
		if (event.type === "toolcall_delta") {
			hasToolDelta = true;
			const toolCall = event.partial.content[event.contentIndex];
			expect(event.contentIndex).toBe(index);
			expect(toolCall.type).toBe("toolCall");
			if (toolCall.type === "toolCall") {
				expect(toolCall.name).toBe("math_operation");
				accumulatedToolArgs += event.delta;
				// Check that we have a parsed arguments object during streaming
				expect(toolCall.arguments).toBeDefined();
				expect(typeof toolCall.arguments).toBe("object");
				// The arguments should be partially populated as we stream
				// At minimum it should be an empty object, never undefined
				expect(toolCall.arguments).not.toBeNull();
			}
		}
		if (event.type === "toolcall_end") {
			hasToolEnd = true;
			const toolCall = event.partial.content[event.contentIndex];
			expect(event.contentIndex).toBe(index);
			expect(toolCall.type).toBe("toolCall");
			if (toolCall.type === "toolCall") {
				expect(toolCall.name).toBe("math_operation");
				JSON.parse(accumulatedToolArgs);
				expect(toolCall.arguments).not.toBeUndefined();
				expect((toolCall.arguments as any).a).toBe(15);
				expect((toolCall.arguments as any).b).toBe(27);
				expect((toolCall.arguments as any).operation).oneOf(["add", "subtract", "multiply", "divide"]);
			}
		}
	}

	expect(hasToolStart).toBe(true);
	expect(hasToolDelta).toBe(true);
	expect(hasToolEnd).toBe(true);

	const response = await s.result();
	expect(response.stopReason).toBe("toolUse");
	expect(response.content.some((b) => b.type === "toolCall")).toBeTruthy();
	const toolCall = response.content.find((b) => b.type === "toolCall");
	if (toolCall && toolCall.type === "toolCall") {
		expect(toolCall.name).toBe("math_operation");
		expect(toolCall.id).toBeTruthy();
	} else {
		throw new Error("No tool call found in response");
	}
}

async function handleStreaming<TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
	let textStarted = false;
	let textChunks = "";
	let textCompleted = false;

	const context: Context = {
		messages: [{ role: "user", content: "Count from 1 to 3", timestamp: Date.now() }],
		systemPrompt: "You are a helpful assistant.",
	};

	const s = stream(model, context, options);

	for await (const event of s) {
		if (event.type === "text_start") {
			textStarted = true;
		} else if (event.type === "text_delta") {
			textChunks += event.delta;
		} else if (event.type === "text_end") {
			textCompleted = true;
		}
	}

	const response = await s.result();

	expect(textStarted).toBe(true);
	expect(textChunks.length).toBeGreaterThan(0);
	expect(textCompleted).toBe(true);
	expect(response.content.some((b) => b.type === "text")).toBeTruthy();
}

async function handleThinking<TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
	let thinkingStarted = false;
	let thinkingChunks = "";
	let thinkingCompleted = false;

	const context: Context = {
		messages: [
			{
				role: "user",
				content: `Think long and hard about ${(Math.random() * 255) | 0} + 27. Think step by step. Then output the result.`,
				timestamp: Date.now(),
			},
		],
		systemPrompt: "You are a helpful assistant.",
	};

	const s = stream(model, context, options);

	for await (const event of s) {
		if (event.type === "thinking_start") {
			thinkingStarted = true;
		} else if (event.type === "thinking_delta") {
			thinkingChunks += event.delta;
		} else if (event.type === "thinking_end") {
			thinkingCompleted = true;
		}
	}

	const response = await s.result();

	expect(response.stopReason, `Error: ${response.errorMessage}`).toBe("stop");
	expect(thinkingStarted).toBe(true);
	expect(thinkingChunks.length).toBeGreaterThan(0);
	expect(thinkingCompleted).toBe(true);
	expect(response.content.some((b) => b.type === "thinking")).toBeTruthy();
}

async function handleImage<TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
	// Check if the model supports images
	if (!model.input.includes("image")) {
		console.log(`Skipping image test - model ${model.id} doesn't support images`);
		return;
	}

	// Read the test image
	const imagePath = join(__dirname, "data", "red-circle.png");
	const imageBuffer = readFileSync(imagePath);
	const base64Image = imageBuffer.toString("base64");

	const imageContent: ImageContent = {
		type: "image",
		data: base64Image,
		mimeType: "image/png",
	};

	const context: Context = {
		messages: [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "What do you see in this image? Please describe the shape (circle, rectangle, square, triangle, ...) and color (red, blue, green, ...). You MUST reply in English.",
					},
					imageContent,
				],
				timestamp: Date.now(),
			},
		],
		systemPrompt: "You are a helpful assistant.",
	};

	const response = await complete(model, context, options);

	// Check the response mentions red and circle
	expect(response.content.length > 0).toBeTruthy();
	const textContent = response.content.find((b) => b.type === "text");
	if (textContent && textContent.type === "text") {
		const lowerContent = textContent.text.toLowerCase();
		expect(lowerContent).toContain("red");
		expect(lowerContent).toContain("circle");
	}
}

async function multiTurn<TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
	const context: Context = {
		systemPrompt: "You are a helpful assistant that can use tools to answer questions.",
		messages: [
			{
				role: "user",
				content: "Think about this briefly, then calculate 42 * 17 and 453 + 434 using the math_operation tool.",
				timestamp: Date.now(),
			},
		],
		tools: [calculatorTool],
	};

	// Collect all text content from all assistant responses
	let allTextContent = "";
	let hasSeenThinking = false;
	let hasSeenToolCalls = false;
	const maxTurns = 5; // Prevent infinite loops

	for (let turn = 0; turn < maxTurns; turn++) {
		const response = await complete(model, context, options);

		// Add the assistant response to context
		context.messages.push(response);

		// Process content blocks
		const results: ToolResultMessage[] = [];
		for (const block of response.content) {
			if (block.type === "text") {
				allTextContent += block.text;
			} else if (block.type === "thinking") {
				hasSeenThinking = true;
			} else if (block.type === "toolCall") {
				hasSeenToolCalls = true;

				// Process the tool call
				expect(block.name).toBe("math_operation");
				expect(block.id).toBeTruthy();
				expect(block.arguments).toBeTruthy();

				const { a, b, operation } = block.arguments;
				if (typeof a !== "number" || typeof b !== "number") throw new Error("Invalid math arguments");
				let result: number;
				switch (operation) {
					case "add":
						result = a + b;
						break;
					case "multiply":
						result = a * b;
						break;
					default:
						result = 0;
				}

				// Add tool result to context
				results.push({
					role: "toolResult",
					toolCallId: block.id,
					toolName: block.name,
					content: [{ type: "text", text: `${result}` }],
					isError: false,
					timestamp: Date.now(),
				});
			}
		}
		context.messages.push(...results);

		// If we got a stop response with text content, we're likely done
		expect(response.stopReason, `Error: ${response.errorMessage}`).not.toBe("error");
		if (response.stopReason === "stop") {
			break;
		}
	}

	// Verify we got either thinking content or tool calls (or both)
	expect(hasSeenThinking || hasSeenToolCalls).toBe(true);

	// The accumulated text should reference both calculations
	expect(allTextContent).toBeTruthy();
	expect(allTextContent.includes("714")).toBe(true);
	expect(allTextContent.includes("887")).toBe(true);
}

describe("Generate E2E Tests", () => {
	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Completions Provider (gpt-4o-mini)", () => {
		const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini");
		void _compat;
		const llm: Model<"openai-completions"> = {
			...baseModel,
			api: "openai-completions",
		};

		it("should complete basic text generation", { retry: 3 }, async () => {
			await basicTextGeneration(llm);
		});

		it("should handle tool calling", { retry: 3 }, async () => {
			await handleToolCall(llm);
		});

		it("should handle streaming", { retry: 3 }, async () => {
			await handleStreaming(llm);
		});

		it("should handle image input", { retry: 3 }, async () => {
			await handleImage(llm);
		});
	});

	describe.skipIf(!process.env.DEEPSEEK_API_KEY)("DeepSeek Provider (deepseek-flash via OpenAI Completions)", () => {
		const llm = getModel("deepseek", "deepseek-flash");

		it("should complete basic text generation", { retry: 3 }, async () => {
			await basicTextGeneration(llm);
		});

		it("should handle tool calling", { retry: 3 }, async () => {
			await handleToolCall(llm);
		});

		it("should handle streaming", { retry: 3 }, async () => {
			await handleStreaming(llm);
		});

		it("should handle thinking mode", { retry: 3 }, async () => {
			await handleThinking(llm, { reasoningEffort: "high" });
		});

		it("should handle multi-turn with thinking and tools", { retry: 3 }, async () => {
			await multiTurn(llm, { reasoningEffort: "high" });
		});
	});

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Responses Provider (gpt-5.4)", () => {
		const llm = getModel("openai", "gpt-5.4");

		it("should complete basic text generation", { retry: 3 }, async () => {
			await basicTextGeneration(llm);
		});

		it("should handle tool calling", { retry: 3 }, async () => {
			await handleToolCall(llm);
		});

		it("should handle streaming", { retry: 3 }, async () => {
			await handleStreaming(llm);
		});

		it("should handle thinking", { retry: 2 }, async () => {
			await handleThinking(llm, { reasoningEffort: "high" });
		});

		it("should handle multi-turn with thinking and tools", { retry: 3 }, async () => {
			await multiTurn(llm, { reasoningEffort: "high" });
		});

		it("should handle image input", { retry: 3 }, async () => {
			await handleImage(llm);
		});
	});

	describe.skipIf(!process.env.OPENROUTER_API_KEY)("OpenRouter Provider (glm-4.5v via OpenAI Completions)", () => {
		const llm = getModel("openrouter", "z-ai/glm-4.5v");

		it("should complete basic text generation", { retry: 3 }, async () => {
			await basicTextGeneration(llm);
		});

		it("should handle tool calling", { retry: 3 }, async () => {
			await handleToolCall(llm);
		});

		it("should handle streaming", { retry: 3 }, async () => {
			await handleStreaming(llm);
		});

		it("should handle thinking mode", { retry: 3 }, async () => {
			await handleThinking(llm, { reasoningEffort: "medium" });
		});

		it("should handle multi-turn with thinking and tools", { retry: 2 }, async () => {
			await multiTurn(llm, { reasoningEffort: "medium" });
		});

		it("should handle image input", { retry: 3 }, async () => {
			await handleImage(llm);
		});
	});

	// =========================================================================
	// OAuth-based providers (credentials from ~/.akramcode/agent/oauth.json)
	// Tokens are resolved at module level (see oauthTokens above)
	// =========================================================================

	describe("Anthropic OAuth Provider (claude-sonnet-4-6)", () => {
		const model = getModel("openrouter", "anthropic/claude-sonnet-4.6");

		it.skipIf(!anthropicOAuthToken)("should complete basic text generation", { retry: 3 }, async () => {
			await basicTextGeneration(model, { apiKey: anthropicOAuthToken });
		});

		it.skipIf(!anthropicOAuthToken)("should handle tool calling", { retry: 3 }, async () => {
			await handleToolCall(model, { apiKey: anthropicOAuthToken });
		});

		it.skipIf(!anthropicOAuthToken)("should handle streaming", { retry: 3 }, async () => {
			await handleStreaming(model, { apiKey: anthropicOAuthToken });
		});

		it.skipIf(!anthropicOAuthToken)("should handle thinking", { retry: 3 }, async () => {
			await handleThinking(model, { apiKey: anthropicOAuthToken, thinkingEnabled: true });
		});

		it.skipIf(!anthropicOAuthToken)("should handle multi-turn with thinking and tools", { retry: 3 }, async () => {
			await multiTurn(model, { apiKey: anthropicOAuthToken, thinkingEnabled: true });
		});

		it.skipIf(!anthropicOAuthToken)("should handle image input", { retry: 3 }, async () => {
			await handleImage(model, { apiKey: anthropicOAuthToken });
		});
	});

	describe("Anthropic OAuth Provider (claude-opus-4-6 with adaptive thinking)", () => {
		const model = getModel("openrouter", "anthropic/claude-opus-4.6");

		it.skipIf(!anthropicOAuthToken)("should complete basic text generation", { retry: 3 }, async () => {
			await basicTextGeneration(model, { apiKey: anthropicOAuthToken });
		});

		it.skipIf(!anthropicOAuthToken)("should handle tool calling", { retry: 3 }, async () => {
			await handleToolCall(model, { apiKey: anthropicOAuthToken });
		});

		it.skipIf(!anthropicOAuthToken)("should handle streaming", { retry: 3 }, async () => {
			await handleStreaming(model, { apiKey: anthropicOAuthToken });
		});

		it.skipIf(!anthropicOAuthToken)("should handle adaptive thinking with effort high", { retry: 3 }, async () => {
			await handleThinking(model, { apiKey: anthropicOAuthToken, thinkingEnabled: true, effort: "high" });
		});

		it.skipIf(!anthropicOAuthToken)("should handle adaptive thinking with effort medium", { retry: 3 }, async () => {
			await handleThinking(model, { apiKey: anthropicOAuthToken, thinkingEnabled: true, effort: "medium" });
		});

		it.skipIf(!anthropicOAuthToken)(
			"should handle multi-turn with adaptive thinking and tools",
			{ retry: 3 },
			async () => {
				await multiTurn(model, { apiKey: anthropicOAuthToken, thinkingEnabled: true, effort: "high" });
			},
		);

		it.skipIf(!anthropicOAuthToken)("should handle image input", { retry: 3 }, async () => {
			await handleImage(model, { apiKey: anthropicOAuthToken });
		});
	});

	describe("OpenAI Codex Provider (gpt-5.5)", () => {
		const llm = getModel("openai-codex", "gpt-6.1-sol");

		it.skipIf(!openaiCodexToken)("should complete basic text generation", { retry: 3 }, async () => {
			await basicTextGeneration(llm, { apiKey: openaiCodexToken });
		});

		it.skipIf(!openaiCodexToken)("should handle tool calling", { retry: 3 }, async () => {
			await handleToolCall(llm, { apiKey: openaiCodexToken });
		});

		it.skipIf(!openaiCodexToken)("should handle streaming", { retry: 3 }, async () => {
			await handleStreaming(llm, { apiKey: openaiCodexToken });
		});

		it.skipIf(!openaiCodexToken)("should handle thinking with reasoningEffort xhigh", { retry: 3 }, async () => {
			await handleThinking(llm, { apiKey: openaiCodexToken, reasoningEffort: "xhigh" });
		});

		it.skipIf(!openaiCodexToken)("should handle multi-turn with thinking and tools", { retry: 3 }, async () => {
			await multiTurn(llm, { apiKey: openaiCodexToken, reasoningEffort: "xhigh" });
		});

		it.skipIf(!openaiCodexToken)("should handle image input", { retry: 3 }, async () => {
			await handleImage(llm, { apiKey: openaiCodexToken });
		});
	});

	describe("OpenAI Codex Provider (gpt-5.5 via WebSocket)", () => {
		const llm = getModel("openai-codex", "gpt-6.1-sol");
		const wsOptions = { apiKey: openaiCodexToken, transport: "websocket" as const };

		it.skipIf(!openaiCodexToken)("should complete basic text generation", { retry: 3 }, async () => {
			await basicTextGeneration(llm, wsOptions);
		});

		it.skipIf(!openaiCodexToken)("should handle tool calling", { retry: 3 }, async () => {
			await handleToolCall(llm, wsOptions);
		});

		it.skipIf(!openaiCodexToken)("should handle streaming", { retry: 3 }, async () => {
			await handleStreaming(llm, wsOptions);
		});

		it.skipIf(!openaiCodexToken)("should handle thinking with reasoningEffort xhigh", { retry: 3 }, async () => {
			await handleThinking(llm, { ...wsOptions, reasoningEffort: "xhigh" });
		});

		it.skipIf(!openaiCodexToken)("should handle multi-turn with thinking and tools", { retry: 3 }, async () => {
			await multiTurn(llm, { ...wsOptions, reasoningEffort: "xhigh" });
		});

		it.skipIf(!openaiCodexToken)("should handle image input", { retry: 3 }, async () => {
			await handleImage(llm, wsOptions);
		});
	});
});
