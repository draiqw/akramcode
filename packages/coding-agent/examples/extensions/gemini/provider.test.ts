import type { Api, AssistantMessage, Context, Model } from "@akramcode/ai";
import { createAssistantMessageEventStream } from "@akramcode/ai/utils/event-stream";
import { describe, expect, it, vi } from "vitest";
import {
	buildRequest,
	convertMessages,
	friendlyAntigravityError,
	streamAntigravity,
	streamResponse,
} from "./stream/stream.ts";

const model: Model<Api> = {
	id: "gemini-2.5-flash",
	name: "Gemini",
	api: "gemini",
	provider: "gemini",
	baseUrl: "https://example.invalid",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 },
	contextWindow: 1048576,
	maxTokens: 8192,
};

function output(): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason: "stop",
		timestamp: 0,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

function sse(payload: unknown): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

async function parse(body: string, chunkSize = 4096) {
	const bytes = new TextEncoder().encode(body);
	let offset = 0;
	const response = new Response(
		new ReadableStream<Uint8Array>({
			pull(controller) {
				if (offset >= bytes.length) {
					controller.close();
					return;
				}
				controller.enqueue(bytes.slice(offset, offset + chunkSize));
				offset += chunkSize;
			},
		}),
	);
	const stream = createAssistantMessageEventStream();
	const message = output();
	const hasContent = await streamResponse(response, stream, message, model);
	stream.end();
	const events = [];
	for await (const event of stream) events.push(event.type);
	return { message, hasContent, events };
}

// Regression coverage for draiqw/akramcode#5: native Gemini transport and transcript replay.
describe("Gemini native stream", () => {
	it("explains a regional API restriction without recommending another login", () => {
		const message = friendlyAntigravityError(
			400,
			JSON.stringify({ error: { message: "User location is not supported for the API use." } }),
		);
		expect(message).toMatch(/location|region/i);
		expect(message).not.toMatch(/login|sign.?in/i);
	});
	it("sends a replaced payload and reports the response before parsed stream events", async () => {
		const chunk = { response: { candidates: [{ content: { parts: [{ text: "hello" }] }, finishReason: "STOP" }] } };
		const order: string[] = [];
		const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
			order.push("fetch");
			expect(JSON.parse(String(init?.body))).toEqual({ replaced: true });
			return new Response(sse(chunk), { headers: { "x-test": "yes" } });
		});
		const stream = streamAntigravity(
			model,
			{ messages: [{ role: "user", content: "hi", timestamp: 0 }] },
			{
				apiKey: JSON.stringify({ token: "mock-token", projectId: "test-project" }),
				fetch,
				onPayload: async () => {
					order.push("payload");
					return { replaced: true };
				},
				onResponse: async (response) => {
					order.push("response");
					expect(response.status).toBe(200);
				},
				onProviderStreamEvent: async (event) => {
					order.push("event");
					expect(event).toEqual(chunk);
				},
			},
		);
		const events = [];
		for await (const event of stream) events.push(event);
		expect(fetch).toHaveBeenCalledOnce();
		expect(order).toEqual(["payload", "fetch", "response", "event"]);
		expect(events.at(-1)).toMatchObject({ type: "done", message: { content: [{ type: "text", text: "hello" }] } });
	});

	it("cancels before sending a request", async () => {
		const controller = new AbortController();
		controller.abort();
		const fetch = vi.fn();
		const stream = streamAntigravity(
			model,
			{ messages: [] },
			{
				apiKey: JSON.stringify({ token: "mock-token", projectId: "test-project" }),
				signal: controller.signal,
				fetch,
			},
		);
		const events = [];
		for await (const event of stream) events.push(event);
		expect(fetch).not.toHaveBeenCalled();
		expect(events).toEqual([expect.objectContaining({ type: "error", reason: "aborted" })]);
	});

	it("cancels an active response after its first provider event", async () => {
		const controller = new AbortController();
		const cancel = vi.fn();
		const fetch = vi.fn(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(body) {
							body.enqueue(
								new TextEncoder().encode(
									sse({ response: { candidates: [{ content: { parts: [{ text: "partial" }] } }] } }),
								),
							);
						},
						cancel,
					}),
				),
		);
		const stream = streamAntigravity(
			model,
			{ messages: [{ role: "user", content: "hi", timestamp: 0 }] },
			{
				apiKey: JSON.stringify({ token: "mock-token", projectId: "test-project" }),
				fetch,
				signal: controller.signal,
				onProviderStreamEvent: () => {
					controller.abort();
				},
			},
		);
		const events = [];
		for await (const event of stream) events.push(event);
		expect(events.at(-1)).toMatchObject({ type: "error", reason: "aborted" });
		expect(cancel).toHaveBeenCalledOnce();
	});
	it.each([1, 2, 7, 4096])("decodes Unicode and tool calls across %i-byte chunks", async (size) => {
		const body =
			sse({ response: { candidates: [{ content: { parts: [{ text: "Привет 🐈" }] } }] } }) +
			sse({
				response: {
					candidates: [
						{
							content: { parts: [{ functionCall: { name: "read", args: { path: "a.ts" } } }] },
							finishReason: "STOP",
						},
					],
					usageMetadata: {
						promptTokenCount: 100,
						cachedContentTokenCount: 40,
						candidatesTokenCount: 7,
						thoughtsTokenCount: 3,
						totalTokenCount: 110,
					},
				},
			}) +
			"data: [DONE]\n";
		const { message, hasContent, events } = await parse(body, size);
		expect(hasContent).toBe(true);
		expect(message.content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "text", text: "Привет 🐈" }),
				expect.objectContaining({ type: "toolCall", name: "read", arguments: { path: "a.ts" } }),
			]),
		);
		expect(message.stopReason).toBe("toolUse");
		expect(message.usage).toMatchObject({ input: 60, output: 10, cacheRead: 40, totalTokens: 110 });
		expect(message.usage.cost.total).toBeCloseTo(0.000011, 10);
		expect(events).toContain("toolcall_end");
	});

	it("handles a completed empty response", async () => {
		const result = await parse(sse({ response: { candidates: [{ finishReason: "STOP" }] } }));
		expect(result.hasContent).toBe(false);
		expect(result.message.content).toEqual([]);
	});

	it("rejects truncated generation and provider errors after partial output", async () => {
		const partial = sse({ response: { candidates: [{ content: { parts: [{ text: "partial" }] } }] } });
		await expect(parse(partial)).rejects.toThrow(/terminated before completion/i);
		await expect(parse(partial + sse({ error: { code: 503, message: "No capacity" } }))).rejects.toThrow(
			/503|capacity/i,
		);
	});
});

describe("Gemini request transcript", () => {
	it("keeps current instructions and tool declarations out of user turns", () => {
		const context: Context = {
			messages: [
				{
					role: "system",
					content: "Use tools",
					toolsAdded: [{ name: "read", description: "Read file", parameters: { type: "object", properties: {} } }],
					timestamp: 0,
				},
				{ role: "user", content: "Read it", timestamp: 1 },
				{ role: "system", content: "", sections: { rules: "Be precise" }, timestamp: 2 },
			],
		};
		const request = buildRequest(model, context, "test-project", {}, model.id);
		expect(JSON.stringify(request.request.systemInstruction)).toContain("Use tools");
		expect(JSON.stringify(request.request.systemInstruction)).toContain("Be precise");
		expect(request.request.tools?.[0]?.functionDeclarations.map((tool) => tool.name)).toEqual(["read"]);
		expect(request.request.contents.some((turn) => String(turn.role) === "system")).toBe(false);
	});

	it("replays tool call/result pairs and user image data", () => {
		const assistant = output();
		assistant.stopReason = "toolUse";
		assistant.content = [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } }];
		const context: Context = {
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Read this" },
						{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
					],
					timestamp: 1,
				},
				assistant,
				{
					role: "toolResult",
					toolCallId: "call-1",
					toolName: "read",
					content: [{ type: "text", text: "file body" }],
					isError: false,
					timestamp: 2,
				},
			],
		};
		const contents = convertMessages(model, context, model.id);
		expect(JSON.stringify(contents)).toContain('"functionCall"');
		expect(JSON.stringify(contents)).toContain('"functionResponse"');
		expect(JSON.stringify(contents)).toContain('"output":"file body"');
		expect(JSON.stringify(contents)).toContain('"mimeType":"image/png"');
		expect(JSON.stringify(contents)).toContain("aGVsbG8=");
	});
});
