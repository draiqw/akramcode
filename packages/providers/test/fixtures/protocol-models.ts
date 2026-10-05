import type { Api, Model } from "@akramcode/ai/types";
import catalog from "./protocol-models.json" with { type: "json" };

/**
 * Model metadata for protocol tests of APIs that no built-in provider uses any more
 * (Anthropic, Bedrock, Google, Mistral, Azure). Snapshot of the entries those tests read.
 */
interface ProtocolApis {
	"amazon-bedrock": "bedrock-converse-stream";
	anthropic: "anthropic-messages";
	"azure-openai-responses": "azure-openai-responses";
	google: "google-generative-ai";
	"google-vertex": "google-vertex";
	mistral: "mistral-conversations";
	openai: "openai-responses";
	openrouter: Api;
}

const models = catalog as unknown as Record<string, Model<Api>[]>;

export function getModel<TProvider extends keyof ProtocolApis>(
	provider: TProvider,
	id: string,
): Model<ProtocolApis[TProvider]> {
	const model = models[provider]?.find((entry) => entry.id === id);
	if (!model) throw new Error(`No protocol fixture model ${provider}/${id}`);
	return structuredClone(model) as Model<ProtocolApis[TProvider]>;
}

export const getBuiltinModel = getModel;

export function getModels<TProvider extends keyof ProtocolApis>(provider: TProvider): Model<ProtocolApis[TProvider]>[] {
	return (models[provider] ?? []).map((model) => structuredClone(model) as Model<ProtocolApis[TProvider]>);
}
