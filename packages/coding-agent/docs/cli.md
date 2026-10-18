<a id="cli-and-modes-reference"></a>

# Command Line

This page documents AkramCode's built-in command-line commands and options. Run `akramcode --help` or append `--help` to a command for the exact interface in your installed version. The top-level help also includes options registered by loaded extensions.

```sh
akramcode [options] [--] [@files...] [messages...]
akramcode install <source> [options]
akramcode remove <source> [options]
akramcode uninstall <source> [options]
akramcode update [target] [options]
akramcode list
akramcode config [options]
akramcode auth <check|print-api-key|print-bearer-token> [options]
akramcode mcp <list|login|logout> [options]
akramcode traces [--port <port>] [--open]
```

<a id="modes"></a>

## Invocation and output

```sh
akramcode
akramcode --print "Summarize this repository"
git diff | akramcode --print "Review this change"
akramcode --mode json "Inspect this repository" > events.jsonl
```

With terminal stdin and stdout, AkramCode opens the terminal UI unless `--print`, `--mode json`, or `--mode rpc` selects another interface. When either stream is redirected and neither JSON nor RPC mode is selected, AkramCode uses print mode. See [CLI Integration](cli-integration.md) for choosing between interactive, print, JSON, RPC, and SDK integration.

| Input | Behavior |
|---|---|
| `message` | Provide an initial prompt |
| `@path` | Include a text file or image in the first prompt |
| Piped stdin | Prepend its contents to the first prompt. When the prompt is given as an argument and stdin sends nothing within 2 seconds, the run continues without it, so a script that leaves stdin open does not hang |
| `--` | Stop option parsing so a prompt can begin with `-` |

AkramCode resolves `@path` from the current working directory. The working directory also controls project configuration, resource discovery, and session grouping.

`--print` controls whether AkramCode runs once and exits. `--mode` selects the output interface. `--mode text` does not force one-shot execution when stdin and stdout are terminals; use `--print` for that behavior.

| Option | Behavior |
|---|---|
| `-p`, `--print` | Run the supplied prompts, write the final assistant text to stdout, then exit. Exits with an error when there is no prompt (no argument, `@file`, or piped input) |
| `--render-markdown` | With `--print`: write the final answer as formatted Markdown (colored headings, tables, highlighted code, rendered math) wrapped to the terminal width, instead of raw Markdown text. Colors and hyperlinks are removed when `NO_COLOR` is set to a non-empty value |
| `--mode text` | Select text output; still open the terminal UI when stdin and stdout are terminals |
| `--mode json` | Run the supplied prompts, write JSONL events to stdout, then exit |
| `--mode rpc` | Read JSONL commands from stdin and write responses and events to stdout until shutdown |
| `--export <input> [output]` | Export a session file to HTML and exit; derive the destination when `output` is omitted |

RPC mode rejects `@file` arguments. JSON and RPC modes reserve stdout for protocol records. See [JSON Event Stream](json.md) and [RPC Protocol](rpc.md).

<a id="model-options"></a>

## Models

```sh
akramcode --model sonnet:high
```

See [Choose a Model](models.md) for model selection and [Providers](providers.md) for credentials.

- `--provider <name>`<br>
  Restricts `--model` lookup to one provider. It requires `--model`.
- `--model <pattern>`<br>
  Selects by exact ID or fuzzy ID/name match. It accepts `provider/id` and an optional `:<thinking>` suffix.
- `--api-key <key>`<br>
  Uses a non-persistent API-key override. It requires a model selected through `--model` or `--models`.
- `--thinking <level>`<br>
  Sets `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. It overrides a `--model` suffix and is clamped to the model's capabilities.
- `--models <patterns>`<br>
  Sets a comma-separated scope for startup and cycling. It accepts exact IDs, fuzzy matches, case-insensitive globs, and optional `:<thinking>` suffixes.
- `--list-models [search]`<br>
  Lists available models, optionally filtered by a fuzzy search, then exits.

<a id="session-options"></a>

## Sessions

```sh
akramcode --resume
```

See [Sessions and Context](sessions.md) for resuming, forking, naming, and storing sessions.

- `-r`, `--resume`<br>
  Opens the session selector.
- `--session <path|id>`<br>
  Opens by file path, exact ID, or partial ID. AkramCode searches the current project first and offers to fork a cross-project match.
- `--session-id <id>`<br>
  Opens the exact project session ID or creates it if absent. IDs accept letters, numbers, `.`, `_`, and `-`.
- `--fork <path|id>`<br>
  Forks an existing session into a new session for the current project.
- `--import <path.jsonl>`<br>
  Copies a session JSONL file, such as one saved by `/share`, into the current project's sessions and resumes it. The original file is not changed.
- `--session-dir <dir>`<br>
  Overrides storage and lookup. It takes precedence over `AKRAMCODE_CODING_AGENT_SESSION_DIR` and the `sessionDir` setting.
- `--no-session`<br>
  Uses an in-memory session that is not persisted.
- `-n`, `--name <name>`<br>
  Sets the session display name.

Constraints:

- Session IDs must start and end with a letter or number.
- `--fork` cannot be combined with `--session`, `--resume`, or `--no-session`.
- `--import` cannot be combined with `--fork`, `--session`, `--session-id`, `--resume`, or `--no-session`.
- `--session-id` cannot be combined with `--session` or `--resume`. Combine it with `--fork` to choose the new ID.

<a id="tool-options"></a>

## Tools

```sh
akramcode --tools read,grep,find,ls --print "Review this project"
```

See [Settings](settings.md#tools) for configuring the default tool selection.

- `-t`, `--tools <list>`<br>
  Replaces the default selection with a comma-separated allowlist of built-in, extension, or custom tools. Names that match no loaded tool are ignored with a warning; `+name` is not a valid form here (it is only valid in `defaultTools`).
- `-xt`, `--exclude-tools <list>`<br>
  Disables comma-separated tool names after all other selection options.
- `-nbt`, `--no-builtin-tools`<br>
  Disables default built-in tools while retaining extension and custom tools.
- `-nt`, `--no-tools`<br>
  Starts with all built-in, extension, and custom tools disabled.

Default enabled tools are `read`, `bash`, `edit`, and `write`, unless `defaultTools` changes them. `--tools` replaces the whole selection, so name every tool you want; `defaultTools` also accepts `+name` and `-name` to change the defaults instead.

| Built-in | Purpose |
|---|---|
| `read` | Read text files and supported images |
| `bash` | Run shell commands |
| `edit` | Apply exact text replacements to an existing file |
| `write` | Create or overwrite a file |
| `grep` | Search file contents |
| `find` | Find paths using glob patterns |
| `ls` | List directory contents |

Built-in extensions add two more tools. They are off by default; the MCP extension turns them on when an MCP server needs them (see [MCP](mcp.md#exposure)). To enable them yourself, name them in `--tools` or `defaultTools`.

| Built-in extension | Purpose |
|---|---|
| `codemode` | Run JavaScript that calls the other tools, for example in parallel with `Promise.allSettled`; only the script's output reaches the model |
| `tool_search` | Search tools that are not declared to the model (`codemode` and `deferred` exposure, such as MCP tools) and declare the matches for the next call |

The built-in `question` extension tool is on by default; `--tools` without it or `--exclude-tools question` turns it off. See [Questions to the user](#questions-to-the-user).

### Questions to the user

`question` lets the model ask one to four multiple-choice questions when it is blocked on a decision that is yours to make. In the terminal it opens a dialog:

- Each question has numbered options with optional descriptions. Several questions show as tabs, followed by a review step.
- `multiSelect` questions use checkboxes: Enter or Space toggles, and the last row submits.
- Every question accepts your own answer: start typing, or pick "Type something…". `@` completes file paths, as in the main editor. A written answer next to a chosen option is sent as a note.
- Attach files and images with the paste key (`ctrl+v`; on macOS it pastes copied files), by dropping files onto the terminal, or with `@path` in the answer. Text files are inlined up to 64 KB; images are sent as images when the model supports them. Backspace on the option list removes the last attachment.
- An option can carry a `preview`, such as a code snippet or layout, shown in a box while it is focused.
- Escape cancels. From a written answer, Escape first returns to the options and keeps the text.

RPC clients get one `select` (or `input` for multiple choice) dialog per question; see [RPC extension UI](rpc-extension-ui.md). In print and JSON modes there is nobody to ask, so the tool tells the model to choose itself and state the assumption.

### Enable codemode

To turn on `codemode` for every session, add it to the default tools in `~/.akramcode/agent/settings.json` or a project's `.akramcode/settings.json`:

```json
{
  "defaultTools": ["+codemode"]
}
```

This keeps `read`, `bash`, `edit`, and `write` and adds `codemode`. For one invocation, list every tool, since `--tools` replaces the selection:

```sh
akramcode --tools read,bash,edit,write,codemode
```

Codemode is useful without MCP: scripts can run several tool calls in parallel, filter large output before it reaches the model, call classifier models such as TypeSafe's Jev through `models.classify()` (see [Classifier models](models.md#use-classifier-models)), and generate images through `models.generateImages()` (see [Image models](models.md#use-image-models)).

### How codemode works

Scripts run in a QuickJS sandbox and reach the other tools through `tools.<name>(args)`. [Codemode](codemode.md) describes the script API, how tools are listed and found, the `store()` and `models` globals, and the limits.

### Tool search

`tool_search` is off by default; enable it with `"defaultTools": ["+tool_search"]` or `--tools`. It uses the same ranking as `searchTools()` over tools that are not declared yet and declares the matches for the next model call. Loaded tools are recorded in the session like other tool changes, so they stay declared on that branch.

<a id="resource-options"></a>

## Resources

```sh
akramcode --extension ./review.ts
```

See [Configuration](configuration.md) for conventional directories, [Settings](settings.md#resources) for configured paths, and [AkramCode Packages](packages.md) for package sources.

- `-e`, `--extension <path>`<br>
  Loads an extension file or directory, or a built-in extension such as `builtin:mcp`, and is repeatable.
- `-ne`, `--no-extensions`<br>
  Disables discovered, configured, and built-in extensions. Explicit `-e` paths still load, so `akramcode -ne -e builtin:mcp` keeps only the built-in MCP support.
- `--skill <path>`<br>
  Loads a skill file or directory and is repeatable.
- `-ns`, `--no-skills`<br>
  Disables discovered and configured skills. Explicit `--skill` paths still load.
- `--prompt-template <path>`<br>
  Loads a prompt-template file or directory and is repeatable.
- `-np`, `--no-prompt-templates`<br>
  Disables discovered and configured templates. Explicit `--prompt-template` paths still load.
- `--theme <path>`<br>
  Loads a theme file or directory and is repeatable.
- `--use-theme <name[/name]>`<br>
  Selects the initial interactive theme for this run.
- `--no-themes`<br>
  Disables discovered and configured themes. Explicit `--theme` paths still load.
- `-nc`, `--no-context-files`<br>
  Disables `AGENTS.md` and `CLAUDE.md` discovery.

Resource paths apply only to the current process. Relative paths resolve from the current working directory.

<a id="prompt-and-display-options"></a>

## Prompts and process

```sh
akramcode --append-system-prompt ./instructions.md
```

See [Configuration](configuration.md) for saved configuration, [Security](security.md#project-resources) for project resources, and [Environment Variables](environment-variables.md) for process controls.

- `--system-prompt <text|path>`<br>
  Replaces the default system prompt with text or the contents of an existing file.
- `--append-system-prompt <text|path>`<br>
  Appends text or an existing file to the system prompt and is repeatable.
- `--verbose`<br>
  Shows verbose interactive startup information, overriding `quietStartup`.
- `--offline`<br>
  Disables automatic network activity, including model catalog refreshes. Equivalent to `AKRAMCODE_OFFLINE=1`.
- `-h`, `--help`<br>
  Shows help, including flags registered by loaded extensions, then exits.
- `-v`, `--version`<br>
  Shows the AkramCode version, then exits.

Extensions may register additional long-form options. Unknown short options are rejected.

## Package commands

```sh
akramcode install npm:@scope/package
```

See [AkramCode Packages](packages.md) for source formats, filtering, installation, and project scope.

### Common tasks

| Task | Command |
|---|---|
| Install a package | `akramcode install <source>` |
| List configured packages | `akramcode list` |
| Remove a package and its settings entry | `akramcode remove <source>` |
| Configure which package resources load | `akramcode config` |

Add `--local` or `-l` to `install`, `remove`, `uninstall`, or `config` to use project settings instead of global settings.

### Update AkramCode or packages

Running `akramcode update` without a target updates AkramCode itself.

| Task | Command |
|---|---|
| Update AkramCode | `akramcode update` |
| Update all installed packages | `akramcode update --extensions` |
| Update one installed package | `akramcode update <source>` |
| Refresh model catalogs | `akramcode update --models` |
| Update AkramCode and all installed packages | `akramcode update --all` |

Add `--force` to reinstall AkramCode when the selected update includes AkramCode.

AkramCode checks the latest [GitHub release](https://github.com/draiqw/akramcode/releases/latest) at startup and shows a notice when a newer version exists; `AKRAMCODE_OFFLINE` or `AKRAMCODE_SKIP_VERSION_CHECK` turns the check off. For the standalone binary installed with `install.sh`, `akramcode update` downloads the release archive for your platform, verifies it against the release's `SHA256SUMS`, checks that the new binary runs and reports the expected version, and then replaces the install directory; the old directory is restored if the swap fails.

The standalone binary also updates itself: in interactive mode, when the startup check finds a newer release, AkramCode downloads and verifies it in the background, says so in the transcript, and installs it when you exit. The next start shows what changed. It is skipped when the installed version is already newer (for example after another session installed an update), and only one session downloads or installs at a time. Set [`autoUpdate`](settings.md#updates-and-telemetry) to `false` to get only the notice.

### Aliases and command options

- `akramcode uninstall <source>` is an alias for `akramcode remove <source>`.
- `akramcode update --self`, `akramcode update self`, and `akramcode update akramcode` are aliases for `akramcode update`.
- `akramcode update --extension <source>` is an alias for `akramcode update <source>`.
- Append `-h` or `--help` to a command for its exact usage and option constraints.

## Credential commands

```sh
akramcode auth check --provider openai --json
```

Authentication commands require `--provider <provider>` or `--model <model>`. See [Providers](providers.md) for supported methods.

| Command | Description |
|---|---|
| `akramcode auth check` | Print `ready`, `not_ready`, or `invalid`; exit with status `0`, `1`, or `2`, respectively |
| `akramcode auth print-api-key` | Print the resolved API key |
| `akramcode auth print-bearer-token` | Print a resolved OAuth bearer token |

| Option | Applies to | Description |
|---|---|---|
| `--provider <provider>` | All | Resolve credentials for a provider |
| `--model <model>` | All | Resolve credentials from a model; may be combined with `--provider` |
| `--json` | `auth check` | Write the structured result as JSON |
| `--credentials` | `auth check` | Emit the resolved credential when ready |
| `--no-refresh` | `auth check` | Do not refresh expired OAuth credentials; refresh is the default |
| `--min-expiry <duration>` | `print-bearer-token` | Require remaining token lifetime using `ms`, `s`, `m`, or `h`, such as `30m` |

Credential-printing commands write secrets to stdout.

## MCP commands

These commands work outside a session, so agents can run them through `bash`. See [MCP Servers](mcp.md).

| Command | Description |
|---|---|
| `akramcode mcp add <server> [options] -- <command> [args...]` | Add or replace a stdio server in `mcp.json`; `--env KEY=VALUE` (repeatable) and `--cwd <dir>` set its environment and working directory. Arguments after the command are passed to it |
| `akramcode mcp add <server> [options] --url <url>` | Add or replace a streamable HTTP server; `--header KEY=VALUE` (repeatable), `--bearer-token-env-var <NAME>` (sends `Authorization: Bearer ${NAME}`), `--oauth-client-id`, `--oauth-client-secret`, `--oauth-callback-port`, and `--oauth-client-name` configure authentication |
| `akramcode mcp remove <server>` | Remove a server from `mcp.json`; stored OAuth credentials are kept |
| `akramcode mcp list [--json]` | Connect to every enabled server and print its state, tools, and errors; exit with `1` when a config entry is invalid or an enabled server is not connected |
| `akramcode mcp login <server> [--timeout <seconds>]` | Sign in to an OAuth server: open the authorization page and wait for the browser (default 300 seconds); a terminal also accepts the pasted redirect URL |
| `akramcode mcp logout <server>` | Delete the stored OAuth credentials of a server |

`add` and `remove` change `~/.akramcode/agent/mcp.json`, or `.akramcode/mcp.json` in the current directory with `--local` (`-l`). `add` also takes `--exposure <mode>` (see [Exposure](mcp.md#exposure)) and `--description <text>` and does not connect; run `akramcode mcp list` to check the server.

## Traces command

`akramcode traces [--port <port>] [--open] [--session-dir <dir>] [--poll <ms>]` starts a local, read-only web UI on `127.0.0.1` with every stored session and subagent transcript: a filterable session list, a per-session timeline with the captured model requests, a network view, and aggregates of tool failures, grouped errors, retries, and latency. The printed URL carries a per-run access token. See [Traces](traces.md).
