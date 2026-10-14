/**
 * Custom Model Selection
 *
 * Shows how to select a specific model and thinking level.
 */

import { createAgentSession, ModelRuntime } from "@akramcode/coding-agent";

const modelRuntime = await ModelRuntime.create();

// Option 1: Find a specific built-in model by provider/id
const claude = modelRuntime.getModel("openrouter", "anthropic/claude-sonnet-4.5");
if (claude) {
	console.log(`Found model: ${claude.provider}/${claude.id}`);
}

// Option 2: Find model via registry (includes custom models from models.json)
const customModel = modelRuntime.getModel("my-provider", "my-model");
if (customModel) {
	console.log(`Found custom model: ${customModel.provider}/${customModel.id}`);
}

// Option 3: Pick from available models (have valid API keys)
const available = await modelRuntime.getAvailable();
console.log(
	"Available models:",
	available.map((m) => `${m.provider}/${m.id}`),
);

if (available.length > 0) {
	const { session } = await createAgentSession({
		model: available[0],
		thinkingLevel: "medium", // off, low, medium, high
		modelRuntime,
	});

	try {
		session.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				process.stdout.write(event.assistantMessageEvent.delta);
			}
		});

		await session.prompt("Say hello in one sentence.");
		console.log();
	} finally {
		session.dispose();
	}
}
