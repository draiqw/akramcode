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

| Provider | Sign in |
|---|---|
| OpenAI | API key or ChatGPT OAuth |
| OpenAI Codex | OAuth |
| OpenRouter | API key or OAuth |
| DeepSeek | API key |
| llama.cpp | Local router URL, optional API key. See [Local Models with llama.cpp](llama-cpp.md) |

Any other OpenAI- or Anthropic-compatible service can be added as a custom provider. See [Models](models.md#configure-a-compatible-endpoint).

The optional [Gemini subscription extension](gemini-subscription.md) adds Google sign-in through `/login gemini` and exposes its models in the same `/model` picker. It is an unofficial Antigravity integration with account restrictions described in that guide.

## Environment variables are ignored

Provider keys and models come only from the agent directory (`auth.json` and `models.json`). Variables such as `OPENAI_API_KEY` or `OPENROUTER_API_KEY` are not read, so a shell or project cannot add providers. Use `/login`, or `--api-key` for a single run.

## How stored credentials are protected

Literal API keys and OAuth tokens in `auth.json` are encrypted with AES-256-GCM. A file that ends up in a backup, a synced dotfiles repository or a pasted log shows `enc:v1:...` instead of the secret.

- The key is read from `AKRAMCODE_SECRETS_KEY` (32 bytes, base64 or hex). Without it, AkramCode creates `secrets.key` next to `auth.json` with owner-only permissions on first write.
- Keep `secrets.key` out of anything that also holds `auth.json`. Without the matching key the credentials cannot be read and AkramCode shows a warning; log in again or restore the key.
- Existing plaintext files keep working and are encrypted the next time AkramCode writes the file.
- `$NAME` and `!command` values are references, not secrets, and stay readable.
- This does not protect against someone who can read both files, or who runs code as your user.

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
