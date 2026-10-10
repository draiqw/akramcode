# Settings Reference

This reference lists user-configurable settings, their types, defaults, and purposes. Project settings override agent-directory settings. Resource lists are combined. See [Configuration](configuration.md) for file locations and trust behavior.

## Model and thinking

<a id="model-cycling"></a>

| Setting | Type | Default | Description |
|---|---|---|---|
| `defaultProvider` | string | Automatic | Startup AI provider. |
| `defaultModel` | string | Automatic | Startup model ID. |
| `defaultThinkingLevel` | `"off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max"` | `"medium"` | Startup thinking level. |
| `modelThinkingLevels` | object | None | Per-model startup thinking levels keyed by exact `provider/modelId`. |
| `thinkingBudgets` | object | Built-in budgets | Token budgets for `minimal`, `low`, `medium`, and `high` thinking levels. |
| `enabledModels` | `string[]` | All available models | Model patterns used for startup selection and model cycling. Uses the same format as `--models`. |
| `hideThinkingBlock` | boolean | `false` | Hide thinking blocks in the transcript. |
| `showCacheMissNotices` | boolean | `false` | Show notices for significant cache misses, successful cache warming, compaction usage, and provider recovery. |
| `cacheWarming` | `"off" \| "streaming" \| "idle"` | `"streaming"` | Keep eligible provider prompt caches warm during active runs or, with `"idle"`, between runs. Global setting only. |

Cache warming runs only when the model declares a cache lifetime and AkramCode estimates at least $0.05 in avoided cache-miss cost. Refresh usage counts toward session totals but does not enter model context. `/session` shows the next decision; extensions can override it with `cache_warming_decision`. See [Prompt Cache Lifetimes](models.md#prompt-cache-lifetimes).

See [Choose a Model](models.md) for model selection and thinking controls.

## Interaction

| Setting | Type | Default | Description |
|---|---|---|---|
| `steeringMode` | `"all" \| "one-at-a-time"` | `"one-at-a-time"` | How queued steering messages are delivered. |
| `followUpMode` | `"all" \| "one-at-a-time"` | `"one-at-a-time"` | How queued follow-up messages are delivered. |
| `externalEditor` | string | `$VISUAL`, `$EDITOR`, then platform default | Command opened by the external-editor keybinding. |
| `doubleEscapeAction` | `"tree" \| "fork" \| "none"` | `"tree"` | Action for double Escape with an empty editor. |
| `doubleEscapeClearsInput` | boolean | `true` | Double Escape with text in the editor clears it. The text is saved to prompt history, so `Up` restores it. |
| `treeFilterMode` | `"default" \| "no-tools" \| "user-only" \| "labeled-only" \| "all"` | `"default"` | Initial filter used by `/tree`. |
| `defaultProjectTrust` | `"ask" \| "always" \| "never"` | `"ask"` | Fallback project-trust behavior. **Can only be set in agent-directory settings.** |

## Tools

| Setting | Type | Default | Description |
|---|---|---|---|
| `defaultTools` | `string[]` | `read`, `bash`, `edit`, `write`, `agent`, `task_stop` | Tools enabled at startup. Plain names replace the defaults; `+name` adds a tool and `-name` removes one. An empty array disables all built-in tools but not extension or SDK tools. `agent` and `task_stop` exist only while [subagents and background tasks](subagents.md) are enabled. |
| `codemode.mode` | `"on"` \| `"only"` | `"on"` | How the `codemode` tool presents tools while it is active. `on`: declared tools get a note on calling them from scripts appended to their description, and `codemode` lists only tools that are not declared. `only`: `codemode` lists every tool scripts can call, and active built-in and extension tools are hidden from the model, so it reaches them through `codemode`. |
| `codemode.inlineBudget` | number | `3000` | Estimated tokens (characters / 4) the `codemode` tool's description may spend on tool declarations. Tools that do not fit are left out and found with `searchTools()`. `0` lists only namespaces. |
| `grep.backend` | `"rg"` \| `"tgrep"` | `"rg"` | Search program of the `grep` tool. See [Grep backend](#grep-backend). |
| `grep.tgrepPath` | string | `tgrep` from `PATH` | tgrep executable for `grep.backend: "tgrep"`. Supports a leading `~`. |
| `subagents.enabled` | boolean | `true` | Offer the `agent` tool, which delegates tasks to subagents, and the `/agents` command. See [Subagents](subagents.md). |
| `backgroundTasks.enabled` | boolean | `true` | Offer `run_in_background` on `bash` and `agent`, monitor mode on `bash`, and the `task_stop` tool. See [Background tasks](subagents.md#background-tasks). |
| `backgroundTasks.printModeTimeoutSeconds` | number | `600` | How long print mode (`-p`) waits for running background tasks before it stops them. |

Available built-in tools are `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`. `defaultTools` can also name `codemode`, `tool_search`, and `update_plan` (see [online compaction](compaction.md#online-compaction-at-plan-steps)), which built-in extensions register inactive, and other extension tools registered inactive.

A list of only `+name` and `-name` entries changes the inherited selection instead of replacing it. For example, this enables `codemode` next to the default tools:

```json
{
  "defaultTools": ["+codemode"]
}
```

This removes `bash` and enables `grep`: `["-bash", "+grep"]`. Project settings apply on top of user settings: a project list with only `+name` and `-name` entries changes the user's selection, and a project list with a plain name replaces it. In one list, plain names form the selection, and `+name` and `-name` then apply in order.

`/reload` enables tools newly added to `defaultTools`. It does not disable tools removed from it or re-enable unchanged tools you turned off. `--tools`, `--no-tools`, and `--no-builtin-tools` override `defaultTools`, also on reload.

CLI tool options override this setting for one invocation; `--tools` does not accept `+name` or `-name`. See [Command Line](cli.md#tools).

### Grep backend

The `grep` tool searches with [ripgrep](https://github.com/BurntSushi/ripgrep) by default. With `"grep": { "backend": "tgrep" }` it asks a running [tgrep](https://github.com/microsoft/tgrep) server instead. tgrep keeps a trigram index of the repository, so a search for a specific identifier reads only the files that can contain it.

The `grep` settings are read from user settings only (`~/.akramcode/agent/settings.json`): a project cannot choose the program the `grep` tool runs. The git check below runs with the repository's `core.fsmonitor` disabled.

AkramCode does not install tgrep or start its server. Install it (`brew install tgrep`) and keep a server running in the repository:

```bash
tgrep serve .
```

The server writes its index to `.tgrep/` in that directory. Add `.tgrep/` to `.gitignore`: the index is build output, and ripgrep searches it when it is not ignored.

For each search, `grep` uses tgrep only when all of these hold, and ripgrep otherwise:

- The search path is a directory. A single file is searched with ripgrep.
- The nearest `.tgrep/serve.json` in the search path or a parent directory names a server that passes the checks below.
- No `write` or `edit` tool call is running or finished in the last 2 seconds. The server applies file changes asynchronously, a few tens of milliseconds after they happen.
- The tools run on this machine. In a `volume` sandbox `grep` does not run; in a `mount` sandbox it runs on the host and may use tgrep.

A repository or another user could plant `.tgrep/serve.json` and point it at a process they control. The server is trusted only when:

- The indexed directory, `.tgrep/` and `serve.json` are not symlinks and not writable by group or others, and `.tgrep/` and `serve.json` belong to you.
- git does not track `.tgrep/serve.json`.
- The named process is alive, runs as you, runs the configured tgrep executable (`grep.tgrepPath`, or `tgrep` from `PATH`, compared by real path), holds `.tgrep/serve.lock` open, and listens on the named port on `127.0.0.1` or `::1`. This is checked with `lsof`; without `lsof`, ripgrep is used.

The first check of a server takes about 100ms; a passing result is reused for 60 seconds while `serve.json` and the process stay the same.

tgrep runs with `--stats`, and its result is used only when tgrep reports that the server answered. If tgrep fails, exits with an error, takes more than 5 seconds, prints more than 256 KiB after reaching the match limit, or answers from its on-disk index or a file scan, the search runs again with ripgrep. An empty result for a directory below the indexed root also runs again with ripgrep, because the index has no files of ignored directories such as `node_modules/pkg`, which ripgrep searches when they are named. The model sees the same output format, match limit and truncation either way.

Results can differ from ripgrep:

- Changes made outside `write` and `edit`, for example by `bash` or an editor, can be missing for a moment until the server has applied them.
- A positive `glob` does not include files that `.gitignore` excludes. ripgrep includes such files when the glob matches them.
- tgrep skips files over 64 MiB and files with known binary extensions, and it never searches `.tgrep/`.
- Lines with invalid UTF-8 are matched as text with replacement characters.
- When the match limit cuts the result, the first matches can come from other files, because neither program returns files in a fixed order.

## Sessions and context

| Setting | Type | Default | Description |
|---|---|---|---|
| `sessionDir` | string | Agent session directory | Session storage directory. Relative paths resolve from the working directory. `AKRAMCODE_CODING_AGENT_SESSION_DIR` and `--session-dir` override this setting. |

### Compaction

| Setting | Type | Default | Description |
|---|---|---|---|
| `compaction.enabled` | boolean | `true` | Enable automatic compaction. |
| `compaction.reserveTokens` | number | `16384` | Tokens reserved for the model response. |
| `compaction.keepRecentTokens` | number | `20000` | Recent tokens retained without summarization. |
| `compaction.modelOverrides` | object | None | Per-model token settings keyed by exact `provider/modelId`. |
| `compaction.restoreContext` | boolean | `true` | After a compaction, append the active request verbatim and recently read files to the summary. |
| `compaction.clearToolResults.enabled` | boolean | `true` | At the threshold, first replace old large tool results with placeholders; summarize only if that is not enough. |
| `compaction.clearToolResults.keep` | number | `3` | Most recent tool results that are never cleared. |
| `compaction.clearToolResults.minResultTokens` | number | `500` | Smaller results are left alone. |
| `compaction.clearToolResults.excludeTools` | string[] | `[]` | Tools whose results are never cleared. |
| `compaction.clearToolResults.targetRatio` | number | `0.85` | Clearing must bring the context to this share of the threshold, otherwise a summary runs instead. |

<a id="per-model-compaction-overrides"></a>

Compaction token values must be non-negative safe integers. Each value resolves independently from the matching model override, then the ordinary compaction setting, then the built-in default. Project and user objects merge before model lookup.

See [Compaction Reference](compaction.md) for trigger, summarization, and validation behavior.

### Branch summaries

| Setting | Type | Default | Description |
|---|---|---|---|
| `branchSummary.reserveTokens` | number | `16384` | Tokens reserved when summarizing branch history. |
| `branchSummary.skipPrompt` | boolean | `false` | Skip the branch-summary prompt and default to no summary. |

## Terminal and display

| Setting | Type | Default | Description |
|---|---|---|---|
| `theme` | string | `"system"` | Built-in or custom theme name. `system` derives colors from the terminal theme. |
| `quietStartup` | boolean \| `"header"` | `false` | `true` hides the startup header and loaded-resource listing. `"header"` keeps the header (version and key hints) but hides the model scope line and loaded-resource listing. The loaded-resource listing (context files, skills, prompts, extensions) is shown only after `app.tools.expand` (default `ctrl+o`). |
| `tuiMode` | `"regular" \| "fullscreen"` | `"fullscreen"` | Interactive terminal UI mode. |
| `fullscreenExitOutput` | `"transcript" \| "resume-hint"` | `"transcript"` | Output printed when fullscreen mode exits. |
| `fullscreenScrollbar` | `"auto" \| "always" \| "hidden"` | `"auto"` | Fullscreen transcript scrollbar behavior. |
| `fullscreenCopyOnSelect` | boolean | `true` | Copy selected text automatically in fullscreen mode. |
| `fullscreenWheelScrollLines` | `"auto"` \| number | `"auto"` | Lines per mouse-wheel event in fullscreen mode, from 1 to 100. `"auto"` moves one line per event in local macOS terminals, which already accelerate wheel and trackpad input; elsewhere, and over SSH, it speeds up fast wheel spins to at most 6 lines per event. Alt+wheel moves five times as far. |
| `editorPaddingX` | number | `0` | Horizontal editor padding from 0 to 3 cells. |
| `outputPad` | `0 \| 1` | `1` | Horizontal transcript padding. |
| `autocompleteMaxVisible` | number | `5` | Visible autocomplete entries, from 3 to 20. |
| `showHardwareCursor` | boolean | `false` | Show the terminal cursor while AkramCode positions it for input methods. |
| `terminal.showImages` | boolean | `true` | Display inline images when supported. |
| `terminal.imageWidthCells` | number | `60` | Preferred inline image width in terminal cells. |
| `terminal.clearOnShrink` | boolean | `false` | Clear empty rows when rendered content shrinks. |
| `terminal.showTerminalProgress` | boolean | `false` | Show OSC 9;4 progress in the terminal tab. |
| `terminal.hyperlinks` | `boolean \| "auto"` | `"auto"` | Override OSC 8 hyperlink detection. |
| `terminal.images` | `"kitty" \| "iterm2" \| "auto" \| false` | `"auto"` | Override inline-image protocol detection. |
| `terminal.trueColor` | `boolean \| "auto"` | `"auto"` | Override true-color detection. |
| `images.autoResize` | boolean | `true` | Resize images to at most 2000 by 2000 pixels before sending them to a model. |
| `images.blockImages` | boolean | `false` | Prevent images from being sent to models. |
| `markdown.codeBlockIndent` | string | `"  "` | Prefix used to indent rendered code blocks. |
| `markdown.mermaid` | `"off" \| "final" \| "streaming"` | `"streaming"` | Mermaid rendering mode. |
| `showWorkingStats` | boolean | `true` | Show elapsed time, output tokens, and tokens per second next to the working indicator. See [Follow AkramCode's work](usage.md#follow-akramcodes-work). |
| `showContextGauge` | boolean | `true` | Show a context-fill bar and the latest response's tokens per second in the footer. |
| `showCacheStatus` | boolean | `true` | Show a footer line with the latest prompt's cache hit ratio, cached tokens, and a countdown to the end of the cache lifetime. |

See [Themes](themes.md) and [Terminal Setup](terminal-setup.md) for format and platform details.

## Network and retries

| Setting | Type | Default | Description |
|---|---|---|---|
| `transport` | `"auto" \| "sse" \| "websocket" \| "websocket-cached"` | `"auto"` | Preferred transport for AI providers that support multiple transports. |
| `httpProxy` | string | None | Proxy URL applied as `HTTP_PROXY` and `HTTPS_PROXY` for AkramCode-managed HTTP clients. **Can only be set in agent-directory settings.** |
| `httpIdleTimeoutMs` | number | `300000` | HTTP header and body idle timeout in milliseconds. Set to `0` to disable. |
| `websocketConnectTimeoutMs` | number | `15000` | WebSocket connection timeout in milliseconds. Set to `0` to disable. |
| `retry.enabled` | boolean | `true` | Enable automatic agent-level retry for transient failures. |
| `retry.maxRetries` | number | `3` | Maximum agent-level retry attempts. |
| `retry.baseDelayMs` | number | `2000` | Initial exponential-backoff delay in milliseconds. |
| `retry.maxAgentDelayMs` | number | `60000` | Maximum agent-level retry delay in milliseconds. |
| `retry.provider.timeoutMs` | number | `httpIdleTimeoutMs` | Provider request timeout in milliseconds. |
| `retry.provider.maxRetries` | number | `0` | Provider-level retry attempts. |
| `retry.provider.maxRetryDelayMs` | number | `60000` | Maximum server-requested delay in milliseconds. Set to `0` to disable the limit. |

Keep `retry.provider.maxRetries` at `0` unless provider-level retries are required. Provider retries can delay AkramCode from handling quota and usage-limit errors itself.

## Shell

| Setting | Type | Default | Description |
|---|---|---|---|
| `shellPath` | string | Platform default | Custom shell executable path. Supports a leading `~`. |
| `shellCommandPrefix` | string | None | Prefix prepended to every shell command. |
| `npmCommand` | `string[]` | `npm` | Command and arguments used for npm package lookup and installation. |

See [Shell aliases](shell-aliases.md) for shell setup and [AkramCode Packages](packages.md) for package-manager behavior.

## Sandbox

The `sandbox` block is global-only and selects where the built-in tools run. See [Run Tools in a Sandbox](sandbox.md).

| Setting | Type | Default | Description |
|---|---|---|---|
| `sandbox.provider` | `"local"` \| `"opensandbox"` | `"local"` | Run tools on this machine or in an OpenSandbox sandbox. |
| `sandbox.workspace` | `"mount"` \| `"volume"` | `"mount"` | Mount the session folder, or keep the workspace in a volume per session. |
| `sandbox.opensandbox` | object | see [sandbox.md](sandbox.md) | Server address, API key, image, limits, reuse and retention. |

## Resources

Resource paths in user settings resolve from the agent directory. Paths in project settings resolve from the project `.akramcode` directory. Absolute paths and `~` are supported.

| Setting | Type | Default | Description |
|---|---|---|---|
| `packages` | array | `[]` | npm, git, or local AkramCode package sources. See [AkramCode Packages](packages.md). |
| `extensions` | `string[]` | `[]` | Extension files or directories. |
| `skills` | `string[]` | `[]` | Skill files or directories. |
| `prompts` | `string[]` | `[]` | Prompt-template files or directories. |
| `themes` | `string[]` | `[]` | Theme files or directories. |
| `enableSkillCommands` | boolean | `true` | Register skills as `/skill:name` commands. |

Resource arrays support glob exclusions with `!pattern`, exact inclusion with `+path`, and exact exclusion with `-path`. AkramCode loads resources listed in both user-level and project settings.

The built-in extensions are named `builtin:mcp`, `builtin:llama.cpp`, `builtin:codemode`, `builtin:tool-search`, `builtin:online-compact`, and `builtin:tasks` (`/tasks`, `/agents`, the running-task footer status, and task notification rendering) in `extensions`. They load by default; `-builtin:mcp` disables one. A `+builtin:<name>` or `-builtin:<name>` entry in project settings overrides the user setting. `akramcode config` lists them under Built-in. `--no-extensions` disables them too, and `-e builtin:<name>` loads one explicitly.

## Traces

Capture of model requests, network activity, and tool executions for [`akramcode traces`](traces.md#capture). **Can only be set in agent-directory settings.**

| Setting | Type | Default | Description |
|---|---|---|---|
| `traces.enabled` | boolean | `true` | Record what each session sends to the model and receives, the HTTP and WebSocket activity of the process, and tool executions in `~/.akramcode/agent/traces/`. The `AKRAMCODE_TRACES` environment variable (`0` or `1`) overrides it. |
| `traces.maxTotalSizeMb` | number | `2048` | Delete the oldest trace files when the directory grows past this size. |
| `traces.maxAgeDays` | number | `30` | Delete trace files older than this. |
| `traces.maxBodyMb` | number | `32` | Largest request body, response body, stream, or tool output kept per record; longer ones are cut and marked. |

## Updates and telemetry

| Setting | Type | Default | Description |
|---|---|---|---|
| `autoUpdate` | boolean | `true` | For the standalone binary installed with `install.sh`: when the startup check finds a newer release, download and verify it in the background and install it when you exit interactive mode. With `false`, a notice tells you to run `akramcode update`. **Can only be set in agent-directory settings.** |
| `collapseChangelog` | boolean | `false` | Show a condensed changelog after an update. |
| `enableInstallTelemetry` | boolean | `true` | Enable anonymous install/update reporting and selected provider attribution headers. Does not control update checks. |
| `enableAnalytics` | boolean | `false` | Opt in to analytics data sharing. Currently used only by the experimental first-run setup. |
