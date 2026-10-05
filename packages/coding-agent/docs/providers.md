# Providers

Most hosted providers support one or both of these authentication methods:

- Sign in through a browser or device flow backed by OAuth.
- Provide an API key.

Use `/login [provider]` to see the methods supported by a provider. 

## Authenticate interactively

Run `/login` and select a provider. AkramCode guides you through its OAuth or API-key flow and saves the resulting credential in [`auth.json`](configuration.md#agent-directory).

On a remote or headless machine, an OAuth callback may not reach the local process. When prompted, paste the final redirect URL or authorization code back into AkramCode.

Run `/logout` and select a provider to remove its stored credential. This does not unset environment variables, remove authentication from `models.json`, or revoke the credential at the provider.

`auth.json` can contain API keys and OAuth tokens. Keep it private and do not commit it.

## Built-in providers

| Provider | Sign in | API key variable |
|---|---|---|
| OpenAI | API key or ChatGPT OAuth | `OPENAI_API_KEY` |
| OpenAI Codex | OAuth | none |
| OpenRouter | API key or OAuth | `OPENROUTER_API_KEY` |
| DeepSeek | API key | `DEEPSEEK_API_KEY` |
| Radius | OAuth or API key | `RADIUS_API_KEY` |

Any other OpenAI-, Anthropic- or Google-compatible service can be added as a custom provider. See [Models](models.md#configure-a-compatible-endpoint).

## Use an API key from the environment

Environment variables are useful in CI and anywhere AkramCode should not store the key. Set the variable before starting AkramCode:

```bash
export OPENAI_API_KEY=sk-...
akramcode
```

## Load an API key from a command

To use a secret manager without writing the resolved key to disk, set a provider's `key` in `auth.json` to a command prefixed with `!`:

```json
{
  "openai": {
    "type": "api_key",
    "key": "!security find-generic-password -ws 'openai'"
  }
}
```

AkramCode runs the command when the key is first needed and caches its standard output for the process lifetime. Empty output, a timeout, or a nonzero exit leaves the key unresolved until AkramCode restarts.

## Provider specific config

### Radius

Radius is a service crafted for AkramCode by the builders of AkramCode, Earendil Works. It provides a customizable AI gateway with organization-level controls and analytics built in, and artifacts for sharing what you create with AkramCode.

To get started, run `/login radius` in AkramCode. This adds Radius as a provider, and its models appear in `/model` like any other provider's.

Radius also has an MCP server, so AkramCode can manage Radius for you.

Radius is currently in early alpha and evolving quickly. See [radius.earendil.com](https://radius.earendil.com) for more.

Radius authentication uses its gateway catalog and caches refreshed model metadata for later offline startup. A custom Radius gateway configured in `models.json` uses its own catalog rather than inheriting the public `radius.pi.dev` catalog.
