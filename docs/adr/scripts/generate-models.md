# Model Generation

Source: packages/providers/scripts/generate-models.ts

## Conservative image preprocessing defaults

The generated image resize defaults must be no less restrictive than the historical image preprocessing in coding-agent. Provider-specific limits can further narrow this profile, but unknown providers retain these cache-safe defaults of 2000px width/height and 4.5 MiB to ensure predictable behavior.

## Authoritative OpenAI pricing

We keep current OpenAI prices hardcoded and authoritative until models.dev and passthrough catalogs catch up to actual pricing changes. This ensures accurate cost tracking even if upstream catalogs lag.

## OpenRouter Anthropic mid-conversation effort limitation

OpenRouter rejects `configuration_update` system messages on Claude Opus 5 with an error, while accepting them on Fable 5.1. We gate mid-conversation reasoning effort support to prevent failures on unsupported models.

## Conservative OpenAI completions defaults

The OpenAI completions API defaults are conservative to prevent unexpected behavior changes across different provider implementations. Built-in behavior is preserved as explicit metadata against the conservative runtime default.

## OpenAI Responses custom grammar tools

OpenAI's Responses endpoints (OpenAI direct and ChatGPT Codex backend) pass custom grammar tools through. OpenAI rejects `type: "custom"` tools for pre-GPT-5 models, so we only enable this for GPT-5 and newer.

## DeepSeek mid-conversation system messages

DeepSeek V4 Pro and OpenAI models behind OpenRouter accept plain system text in place after the conversation has started. This unconventional capability requires explicit metadata.

## OpenAI Responses transcript system messages

Newer OpenAI Responses models accept developer role messages after the conversation has started, enabling mid-conversation system message updates.

## Explicit prompt cache mode for caching models

OpenAI charges for prompt-cache writes starting with the GPT-5.6 family, and only those models accept `prompt_cache_options`. Older models reject the parameter, so we mark explicit cache mode support only for models with non-zero cache-write cost.

## Anthropic adaptive thinking model capability

Per Anthropic's adaptive thinking documentation, all adaptive-thinking models support "max" reasoning level. Only Opus 4.7/4.8/5, Sonnet 5, and Fable 5 support "xhigh".

## Mercury 2 instant mode tool calling limitation

Mercury 2 in instant mode (reasoning_effort: "none") disables tool calling. We mark "off" as unsupported so the openai-completions provider omits the reasoning parameter instead of defaulting to `{reasoning: {effort: "none"}}`.

## Models.dev OpenAI alias limitation

Models.dev lists the gpt-5-pro alias, but it is not accepted by OpenAI's actual APIs. We skip it to avoid runtime errors.

## Short-context OpenAI model pricing

Keep direct OpenAI requests in the short-context pricing tier by default. Users can opt into larger context through model overrides, so we retain long-context cost metadata on capped models to enable informed decisions.

## OpenAI GPT-5-Pro output limit correction

Models.dev reports gpt-5-pro output as 272000 (duplicating the input sub-limit), but the actual max output is 128000. We correct this discrepancy.

## Kimi K3 output limit stability

We keep Kimi K3's canonical output limit when gateway metadata is missing or incorrect to maintain stable behavior.

## OpenRouter model metadata stabilization

We keep selected OpenRouter model metadata stable until upstream settles on final values. This prevents churn from premature API changes.

## OpenRouter Fusion router metadata note

OpenRouter exposes Fusion as a router alias/plugin entry point. Its model metadata does not advertise tools, but the alias resolves to a concrete model that can invoke caller tools and has the openrouter:fusion server tool auto-injected.

## Built-in provider catalog limitation

Only the four main providers (deepseek, openai, openai-codex, openrouter) ship in the built-in catalog. Anything else is reached through user-defined providers (models.json or extensions).

## Model catalog priority ordering

When adding models to the catalog, we only add them if not already present. This ensures models.dev takes priority over OpenRouter for the same model ID.
