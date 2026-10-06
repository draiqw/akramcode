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

Any other OpenAI- or Anthropic-compatible service can be added as a custom provider. See [Models](models.md#configure-a-compatible-endpoint).

## Use an API key from the environment

Environment variables are useful in CI and anywhere AkramCode should not store the key. Set the variable before starting AkramCode:

```bash
export OPENAI_API_KEY=sk-...
akramcode
```

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
