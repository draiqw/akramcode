import { join } from "node:path";
import { getDocsPath } from "../config.ts";

const UNKNOWN_PROVIDER = "unknown";

export function getProviderLoginHelp(): string {
	return `Use /login to connect a subscription, an API key, or a local model. See ${join(getDocsPath(), "models.md")}`;
}

export function formatNoModelsAvailableMessage(): string {
	return `No models available. ${getProviderLoginHelp()}`;
}

export function formatNoModelSelectedMessage(): string {
	return `No model selected.\n\n${getProviderLoginHelp()}\n\nThen use /model to select a model.`;
}

export function formatNoApiKeyFoundMessage(provider: string): string {
	// The placeholder model of a fresh install has no provider: say that no model is selected, not that a key is missing.
	if (provider === UNKNOWN_PROVIDER) return formatNoModelSelectedMessage();
	return `No API key found for ${provider}.\n\n${getProviderLoginHelp()}`;
}
