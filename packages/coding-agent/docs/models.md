# Choose a Model

For a built-in provider, start with `/login`, then choose a model with `/model`. Use custom model configuration only when AkramCode does not already include the provider or endpoint you need.

## Choose a connection

| What you have | Recommended setup |
|---|---|
| A supported subscription | Sign in through `/login` |
| A provider API key | Store it through `/login` or set its environment variable |
| A local GGUF model | Connect AkramCode to the llama.cpp router |
| An OpenAI- or Anthropic-compatible endpoint | Add it to `models.json` |
| A provider with a custom protocol or authentication flow | Build or install a provider extension |

Current providers, model IDs, capabilities, context limits, and pricing. AkramCode starts with its bundled catalog and can overlay newer catalog data from a remote catalog. Cached catalog data remains available offline; run `akramcode update --models` to force a refresh.

## Authenticate

Run `/login` and select a provider. AkramCode stores credentials in [`auth.json`](configuration.md#agent-directory). Run `/logout` to remove stored credentials for a provider.

You can instead provide an API key through the provider's environment variable. This is useful in CI and other environments where AkramCode should not write credentials. [Providers](providers.md) lists the variables and provider-specific setup.

When several credential sources are configured, AkramCode uses a runtime `--api-key` first, then a stored `auth.json` credential, an `apiKey` from `models.json`, and finally the provider's environment variables or ambient cloud credentials. Provider extensions can define their own authentication behavior.

Keep `auth.json` and any credential commands private. Project settings and extensions can execute inside the AkramCode process after you trust a project. Review [Security](security.md) before loading configuration from an untrusted directory.

## Select a model

Run `/model` to search available models. The picker shows models whose providers have usable authentication. Press `Ctrl+S` on a model to save it as the default for new sessions.

After you select a model in `/model`, select its thinking level. Press `Ctrl+S` there to save the startup level. AkramCode limits the choices to levels supported by the selected model.

`Ctrl+P` cycles through available models. Limit that cycle with `--models` or model patterns in [Settings](settings.md#model-cycling).

A session records model and thinking-level changes. Resuming the session restores them without changing defaults for new sessions.

## Connect local models

AkramCode integrates directly with the llama.cpp router. The router discovers GGUF files and loads models on demand. `/model` selects one of its loaded models.

Follow [Local Models with llama.cpp](llama-cpp.md) for server startup, model layout, and connection troubleshooting.

For LM Studio, vLLM, SGLang, and other compatible servers, [configure a compatible endpoint](#configure-a-compatible-endpoint) in `models.json`.

## Configure a compatible endpoint

Use [`models.json`](configuration.md#agent-directory) when an endpoint speaks an API AkramCode already supports. This includes most LM Studio, vLLM, SGLang, and proxy deployments.

```json
{
  "providers": {
    "local": {
      "baseUrl": "http://localhost:8000/v1",
      "api": "openai-completions",
      "apiKey": "local",
      "models": [
        { "id": "qwen2.5-coder:7b" }
      ]
    }
  }
}
```

The dummy key makes the model available to AkramCode; local servers usually ignore it. For an authenticated endpoint, `apiKey` and header values can use `$NAME` or `${NAME}` environment interpolation, a literal value, or a leading `!command`. Commands in `models.json` run at request time and are not cached by AkramCode.

Opening `/model` reloads the file. A `models` entry adds or replaces a model with the same ID on that provider. Use `modelOverrides` to change metadata for an existing built-in or extension-provided model without replacing the provider's model list. Unknown override IDs are ignored.

### One file for the whole registry

`models.json` is the single place to describe providers and models. No database is involved: the file is read on startup and whenever `/model` opens. It can switch built-in providers and models on or off, add your own, set prices, and point at keys without storing them in the file.

```json
{
  "providers": {
    "openrouter": { "enabled": false },
    "openai": {
      "apiKey": "$OPENAI_API_KEY",
      "modelOverrides": {
        "gpt-5": { "enabled": false },
        "gpt-5-mini": { "cost": { "input": 0.25, "output": 2 } }
      }
    },
    "local": {
      "name": "Local server",
      "baseUrl": "http://localhost:8000/v1",
      "api": "openai-completions",
      "apiKey": "local",
      "models": [
        { "id": "qwen3-coder", "contextWindow": 131072, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 } },
        { "id": "old-model", "enabled": false }
      ]
    }
  }
}
```

- `enabled: false` on a provider removes it from `/login`, `/model` and `--list-models`, built-in or custom. `enabled: true` changes nothing.
- `enabled: false` on a `models` entry or in `modelOverrides` hides that model.
- `modelOverrides` changes metadata such as `cost`, `contextWindow` or `name` of an existing built-in model without replacing the provider's model list.
- `apiKey` accepts a literal value, `$NAME` or `${NAME}` environment interpolation, or a leading `!command`. Prefer the last two so the file holds no secrets.

### Describe model input and caching

Use `inputLimits.images.resize` to control how AkramCode encodes new image attachments, `read` results, and tool-result images before storing them in conversation history:

```json
{
  "id": "vision-model",
  "input": ["text", "image"],
  "inputLimits": {
    "images": {
      "resize": {
        "maxWidth": 1568,
        "maxHeight": 1568,
        "maxBytes": 524288,
        "jpegQuality": 75
      }
    }
  }
}
```

`maxBytes` limits the base64-encoded payload. Omitted resize fields use conservative defaults of 2000 by 2000 pixels, 4.5 MiB encoded, and JPEG quality 80. Images are encoded once; changing models does not rewrite historical images. The catalog can also describe hard request limits with `inputLimits.maxRequestBytes`, `images.maxPerMessage`, and `images.maxPerRequest`, but AkramCode does not yet rewrite or reject history based on them.

<a id="prompt-cache-lifetimes"></a>

Use `promptCache` to declare the provider's best-effort cache lifetime in seconds for the `short` or `long` retention tier:

```json
{ "id": "claude-sonnet-5", "promptCache": { "short": 300, "long": 3600 } }
```

Choose the conservative end of any published range. A model without a lifetime for the active tier is not eligible for cache warming. A `modelOverrides` entry can set `inputLimits` or `promptCache` for a built-in or extension model, including a model accessed through a validated proxy. See [`cacheWarming`](settings.md#model-and-thinking).

Compatibility settings should describe verified differences in the endpoint's request or response behavior. Do not enable them based only on an endpoint advertising OpenAI or Anthropic compatibility.

## Use classifier models

Classifier models do not chat. They answer typed questions about JSON state: pick one of several choices, answer yes or no, or give a score, each with probabilities. AkramCode includes TypeSafe's Jev model from these providers:

| Provider | Model IDs | Authentication |
|---|---|---|
| `typesafe` | `jev-latest` | `TYPESAFE_API_KEY` |
| `openrouter` | `typesafe/jev-1.13`, `~typesafe/jev-latest` | `OPENROUTER_API_KEY` or `/login` |
| `cloudflare-workers-ai` | `typesafe/jev` | `CLOUDFLARE_API_KEY` and `CLOUDFLARE_ACCOUNT_ID` |
| `vercel-ai-gateway` | `typesafe-ai/jev` | `AI_GATEWAY_API_KEY` |
| `opencode` | `jev-1.13`, `jev-1.13-free` | `OPENCODE_API_KEY` |

Chat models on a [llama.cpp router](llama-cpp.md#classification) are also listed as classifier models.

Classifier models do not appear in `/model`. The model reaches them through the [`codemode`](cli.md#enable-codemode) tool, which is off unless an MCP server turned it on. Enable it with `"defaultTools": ["+codemode"]` in [settings](settings.md#tools). Scripts then list classifier models with `models.getAvailableOfType("classifier")` and call `models.classify(model, { state, questions })`:

```js
const jev = await models.getModelOfType("classifier", "typesafe", "jev-latest");
const result = await models.classify(jev, {
  state: { message: "The change works, thanks." },
  questions: {
    approved: {
      type: "bool",
      instructions: "Does the user approve of the result?",
      criteria: { true: "Approval", false: "No approval" },
    },
  },
});
return result.answers;
```

[Codemode](codemode.md#classify) describes the question and answer types.

When the service reports token counts, as all System One services do, `result.usage` carries them with their cost. AkramCode adds the usage of a script's classifier calls to the `codemode` tool result, so it counts toward the session cost in the footer and `/usage`. The cost uses the model's catalog price; models without one, such as TypeSafe's direct `jev-latest`, report tokens at no cost.

Extensions call classifiers through `ctx.modelRegistry.classify()`, without codemode. [Virtual models](virtual-models.md#route-requests) can use them to route requests; see the `jev-router.ts` example.

## Use image models

Image models generate images from a prompt and optional input images. AkramCode lists OpenRouter's image models, such as `google/gemini-2.5-flash-image` and `black-forest-labs/flux.2-pro`, under the `openrouter` provider; they use the same `OPENROUTER_API_KEY` or `/login` credential as its chat models.

Like classifier models, image models do not appear in `/model`; the model reaches them through the [`codemode`](cli.md#enable-codemode) tool. Scripts list them with `models.getAvailableOfType("image")` and call `models.generateImages(model, { input })`. The result's `output` holds base64 image blocks, which `image()` attaches to the `codemode` result so the model sees them:

```js
const painter = await models.getModelOfType("image", "openrouter", "google/gemini-2.5-flash-image");
const result = await models.generateImages(painter, {
  input: [{ type: "text", text: "A red fox in the snow, watercolor" }],
});
if (result.stopReason !== "stop") return result.errorMessage;
for (const block of result.output) if (block.type === "image") image(block);
```

`input` can also contain `{ type: "image", data, mimeType }` blocks to edit or use as references. AkramCode adds the usage of a script's image calls to the `codemode` tool result, like classifier calls. Generated images are not saved to disk. [Codemode](codemode.md#generate-images) describes the full API.

Extensions generate images through `ctx.modelRegistry.generateImages()`, without codemode.

## Add a custom provider

Use an extension when the provider needs custom streaming, model discovery, or authentication behavior. See [Custom Providers](custom-provider.md) for the extension workflow.

## Troubleshooting

### A model does not appear

Confirm that its provider has usable authentication. Custom models can load from `models.json` but remain unavailable in `/model` until AkramCode can resolve credentials. For llama.cpp, only models currently loaded by the router appear.

### Authentication works in one shell only

Check whether the key came from an environment variable rather than `auth.json`. Environment variables must be present in the process that starts AkramCode.

### Sign-in opens a browser on a remote machine

Complete the provider's headless authentication flow when available. Some providers let you paste the final redirect URL or authorization code back into AkramCode. See [Authenticate interactively](providers.md#authenticate-interactively).

### A compatible endpoint rejects requests

Check its API type and compatibility settings in `models.json`. The upstream server must support the corresponding request fields and behavior.
