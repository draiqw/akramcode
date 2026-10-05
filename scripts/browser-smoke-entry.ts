import { Client } from "@akramcode/client";
import { createAssistantMessageEventStream, Type } from "@akramcode/ai";
import { complete, getModel, getProviders, streamSimple } from "@akramcode/providers/compat";
import { Agent, streamProxy } from "@akramcode/agent-core";
import { decodeCbor, encodeCbor, PROTOCOL_VERSION } from "@akramcode/protocol";

// Keep this entry browser-safe. It is bundled by scripts/check-browser-smoke.mjs
// to catch accidental Node-only runtime imports in browser-facing package exports.
const model = getModel("google", "gemini-2.5-flash");
const schema = Type.Object({ prompt: Type.String() });
const stream = createAssistantMessageEventStream();

const agent = new Agent({ initialState: { model }, streamFn: streamSimple });
agent.steer({ role: "user", content: [{ type: "text", text: "queued" }], timestamp: 0 });

console.log(
	model.id,
	getProviders().length,
	typeof complete,
	schema.type,
	typeof stream.push,
	agent.hasQueuedMessages(),
	typeof streamProxy,
	typeof Client,
	PROTOCOL_VERSION,
	decodeCbor(encodeCbor({ browser: true })),
);
