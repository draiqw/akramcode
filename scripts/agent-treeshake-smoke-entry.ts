import { Agent } from "@akramcode/agent-core";
import { createModels } from "@akramcode/ai";
import { openaiProvider } from "@akramcode/providers/providers/openai";

const models = createModels();
models.setProvider(openaiProvider());
const model = models.getModel("openai", "gpt-5-mini");
if (!model) throw new Error("OpenAI smoke-test model not found");

export const agent = new Agent({
	initialState: { model },
	streamFn: models.streamSimple.bind(models),
});
