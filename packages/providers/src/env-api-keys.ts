import type { KnownProvider, ProviderEnv } from "@akramcode/ai/types";
import { getProviderEnvValue } from "@akramcode/ai/utils/provider-env";

// Read by the Anthropic Messages API implementation (federation and bearer-token auth).
export const ANTHROPIC_AUTH_TOKEN_ENV = "ANTHROPIC_AUTH_TOKEN";
export const ANTHROPIC_OAUTH_TOKEN_ENV = "ANTHROPIC_OAUTH_TOKEN";
export const ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";
export const ANTHROPIC_FEDERATION_RULE_ID_ENV = "ANTHROPIC_FEDERATION_RULE_ID";
export const ANTHROPIC_ORGANIZATION_ID_ENV = "ANTHROPIC_ORGANIZATION_ID";
export const ANTHROPIC_SERVICE_ACCOUNT_ID_ENV = "ANTHROPIC_SERVICE_ACCOUNT_ID";
export const ANTHROPIC_IDENTITY_TOKEN_FILE_ENV = "ANTHROPIC_IDENTITY_TOKEN_FILE";
export const ANTHROPIC_WORKSPACE_ID_ENV = "ANTHROPIC_WORKSPACE_ID";

const API_KEY_ENV_VARS: Readonly<Record<string, string>> = {
	openai: "OPENAI_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	radius: "RADIUS_API_KEY",
};

/** Configured environment variables that can provide an API key for a provider. */
export function findEnvKeys(provider: KnownProvider, env?: ProviderEnv): string[] | undefined;
export function findEnvKeys(provider: string, env?: ProviderEnv): string[] | undefined;
export function findEnvKeys(provider: string, env?: ProviderEnv): string[] | undefined {
	const envVar = API_KEY_ENV_VARS[provider];
	return envVar && getProviderEnvValue(envVar, env) ? [envVar] : undefined;
}

/**
 * Get an API key for a provider from its environment variable, e.g. OPENAI_API_KEY.
 *
 * Will not return API keys for providers that require OAuth tokens.
 */
export function getEnvApiKey(provider: KnownProvider, env?: ProviderEnv): string | undefined;
export function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined;
export function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined {
	const envKey = findEnvKeys(provider, env)?.[0];
	return envKey ? getProviderEnvValue(envKey, env) : undefined;
}
