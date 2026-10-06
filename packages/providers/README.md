# @akramcode/providers

Providers and model catalog layer of AkramCode. Built-in providers: OpenRouter, DeepSeek, OpenAI (API key) and OpenAI Codex (ChatGPT subscription login).

Supported protocols: `openai-responses`, `openai-completions`, `openai-codex-responses`, `anthropic-messages` (used by OpenRouter), `openrouter-images`, `typesafe-system-one`. Any custom provider that speaks one of them can be added through `models.json`.

## Model data

Provider catalogs in `src/providers/data/` are generated, not committed (see `.gitignore`). The Codex models are defined in `scripts/generate-models.ts`; the others are fetched from models.dev and the OpenRouter API.

A fresh clone needs network access once:

```bash
npm install
npm run hydrate:model-data   # from the repository root; writes src/providers/data/ and its manifest
npm run build
```

`npm run check:model-data` (part of `build:offline`) fails when the data is missing or does not match its manifest.

## Layout

- `src/api/` protocol implementations (with `*.lazy.ts` loaders)
- `src/providers/` provider definitions and their model lists
- `src/auth/oauth/` login flows (OpenAI Codex, OpenAI ChatGPT, OpenRouter)
- `scripts/` model data generator and validation
