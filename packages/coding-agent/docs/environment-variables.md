# Environment Variables

AkramCode uses environment variables in three ways:

- Variables such as `AKRAMCODE_OFFLINE` configure the AkramCode process.
- AkramCode sets process markers so child processes can identify AkramCode as the launching agent.
- Commands run by the LLM-callable shell tools receive `AKRAMCODE_*` variables describing the current session.

Provider API-key variables are documented separately in [Providers](providers.md#use-an-api-key-from-the-environment).

## Process Marker

The CLI and RPC entry points set two process markers:

- `AI_AGENT=akramcode` is a generic marker that lets tooling identify AkramCode as the agent that launched the process.
- `AKRAMCODE_CODING_AGENT=true` is AkramCode-specific and lets child processes detect that they run inside AkramCode.

Child processes inherit both markers. They are not session-specific and are not set automatically when AkramCode is embedded through the SDK.

## Shell Tool Session Environment

Commands run by the `bash` and `powershell` tools receive the current AkramCode session state:

| Variable | Description |
|----------|-------------|
| `AKRAMCODE_SESSION_ID` | Current session ID |
| `AKRAMCODE_SESSION_FILE` | Absolute path to the current session JSONL file; unset for ephemeral sessions |
| `AKRAMCODE_PROVIDER` | Currently selected model provider |
| `AKRAMCODE_MODEL` | Currently selected model ID |
| `AKRAMCODE_REASONING_LEVEL` | Current effective reasoning level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` |

The values are resolved when each command starts. Switching models or changing the reasoning level therefore affects the next shell command without restarting AkramCode. `AKRAMCODE_PROVIDER` and `AKRAMCODE_MODEL` identify the selected AkramCode model, not a different upstream model that a router may choose internally.

When asked which model or provider is running, inspect these variables instead of inferring the answer from the system prompt:

```bash
printf '%s/%s\n' "$AKRAMCODE_PROVIDER" "$AKRAMCODE_MODEL"
printf 'reasoning=%s session=%s\n' "$AKRAMCODE_REASONING_LEVEL" "$AKRAMCODE_SESSION_ID"
```

The session file can be inspected directly when the session is persistent:

```bash
if [ -n "$AKRAMCODE_SESSION_FILE" ]; then
  tail -n 1 "$AKRAMCODE_SESSION_FILE"
fi
```

These variables are injected into the LLM-callable `bash` and `powershell` tools. They are not injected into user-entered `!` or `!!` commands.

### Custom Shell Tools

Tools created with `createBashTool()` or `createPowerShellTool()` expose the session environment by default when registered with AkramCode. Injection happens before `spawnHook`, so a hook receives the variables in `ctx.env`:

```typescript
const bashTool = createBashTool(cwd, {
  spawnHook: (ctx) => ({
    ...ctx,
    env: { ...ctx.env, CI: "1" },
  }),
});
```

Disable session metadata independently of the spawn hook:

```typescript
const powershellTool = createPowerShellTool(cwd, {
  exposeSessionEnvironment: false,
  spawnHook: (ctx) => ctx,
});
```

When disabled, AkramCode removes inherited values for these variables so nested AkramCode processes do not expose stale parent-session metadata.

## AkramCode Process Configuration

These variables are read by AkramCode itself:

| Variable | Description |
|----------|-------------|
| `AKRAMCODE_CODING_AGENT_DIR` | Override the config directory; default is `~/.akramcode/agent` |
| `AKRAMCODE_CODING_AGENT_SESSION_DIR` | Override session storage; overridden by `--session-dir` |
| `AKRAMCODE_PACKAGE_DIR` | Override the package directory, useful for Nix/Guix store paths |
| `AKRAMCODE_OFFLINE` | Disable automatic network activity, including model catalog refreshes |
| `AKRAMCODE_SKIP_VERSION_CHECK` | Disable the `pi.dev` latest-version request |
| `AKRAMCODE_TELEMETRY` | Override install/update telemetry and provider attribution headers: `1`/`true`/`yes` or `0`/`false`/`no` |
| `AKRAMCODE_CACHE_RETENTION` | Set to `long` for extended provider prompt caching where supported |
| `AKRAMCODE_SHARE_VIEWER_URL` | Override the base URL used by `/share` |
| `AKRAMCODE_HARDWARE_CURSOR` | Set to `1` to show the hardware cursor; see [Terminal setup](terminal-setup.md) |
| `AKRAMCODE_HYPERLINKS` | Override OSC 8 hyperlink detection with `1`, `0`, or `auto` |
| `AKRAMCODE_IMAGE_PROTOCOL` | Override inline image detection with `kitty`, `iterm2`, `none`, or `auto` |
| `AKRAMCODE_TRUE_COLOR` | Override truecolor detection with `1`, `0`, or `auto` |
| `AKRAMCODE_TUI_ESC_TIMEOUT` | How long to wait after a lone ESC before treating it as Escape, in milliseconds; defaults to `100` over SSH and `10` otherwise. Increase if Alt-key input is misread as Escape |
| `VISUAL`, `EDITOR` | External editor fallback when `externalEditor` is unset |
| `HTTP_PROXY`, `HTTPS_PROXY` | Proxy outbound HTTP requests |

Provider credentials such as `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, and provider-specific configuration are listed in [Providers](providers.md#use-an-api-key-from-the-environment).
