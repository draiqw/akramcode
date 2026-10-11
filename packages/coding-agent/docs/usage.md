# Use AkramCode in the terminal

Run `akramcode` from the folder you want to work in. AkramCode uses that folder to discover files, instructions, and configuration, and to group saved sessions. If you have not installed AkramCode or chosen a model yet, follow the [Quickstart](quickstart.md).

AkramCode may ask whether you trust the working folder before loading its project resources. See [Project trust](security.md#understand-project-trust).

<p align="center"><img src="images/interactive-mode.png" alt="AkramCode interactive mode showing a conversation, editor, and status information" width="750"></p>

The transcript shows your prompts, AkramCode's responses, tool calls, results, and errors. You write prompts and commands in the editor. The footer shows the current folder, session, model, context usage, and accumulated usage and cost.

## Enter a prompt

Type a request and press `Enter` to send it. Use `Shift+Enter` to add a line, or press `Ctrl+G` to work on a longer prompt in your configured external editor.

To include files or images:

- Type `@` to search for a file and add it to your prompt.
- Press `Tab` to complete a path.
- Paste an image or drag it into a compatible terminal.

## Follow AkramCode's work

AkramCode shows a run of tool calls as one line, such as `Thought for 2s, read 2 files, ran 1 shell command`. Press `Ctrl+O` to expand the full output; the expanded group starts with a `ctrl+o to collapse` header, and pressing `Ctrl+O` again or clicking the header collapses it. Press `Ctrl+T` to show or hide thinking blocks.

The startup header shows the name and version; `Ctrl+O` also lists the instructions and resources AkramCode loaded. The footer is one line with the working directory, context use, and model, marked `(sub)` on a subscription. `/usage` shows the session details and cost by model, a GitHub-style daily activity graph, and token and cost totals for all sessions over 7, 30, and 90 days and all time, at API prices.

While AkramCode works, the editor border shows how long the run has taken, the output tokens so far, and the generation speed, for example `Working · 1m 05s · ↓ 1.2k tokens · 48.0 tok/s`. Output tokens are estimated at four characters per token while a response streams and replaced by the provider's count when it ends. Speed is measured from the first streamed token of a response, so waiting for the first token and running tools do not lower it.

The footer shows context use as a bar next to the percentage, for example `████░░░░░░ 37.2%/200k`, and the speed of the latest response. When the latest response used the prompt cache, the footer adds `cache 83% 4:12`: the share of the latest prompt read from the cache, and a countdown from the latest request or [cache-warming](settings.md#model-and-thinking) refresh to the end of the cache lifetime (`5m` for short retention, `1h` for long retention on most providers). After it reaches zero, it reads `cold`: the next request rewrites the cache. The countdown is omitted when the model declares no cache lifetime. `showWorkingStats`, `showContextGauge`, and `showCacheStatus` turn these off. See [Terminal and display](settings.md#terminal-and-display).

AkramCode does not ask before every tool call. Review commands and changed files, and use a sandbox for untrusted or unattended work. See [Security](security.md).

## Change direction

You can send more input while AkramCode is working:

| What you want | Action |
|---|---|
| Adjust the current task | Type a message and press `Enter` |
| Add work after the current task | Type a message and press `Alt+Enter` |
| Return queued messages to the editor | Press `Alt+Up` |
| Stop the current task | Press `Escape` |

Press `Escape` twice with text in the editor to clear it. The text is saved to prompt history, so `Up` brings it back. Set `doubleEscapeClearsInput` to `false` to turn this off.

A message sent with `Enter` waits until the current response and its tool calls finish, then guides the next response. A follow-up sent with `Alt+Enter` waits until AkramCode finishes the current task. Aborting returns queued messages to the editor.

Windows Terminal reserves some Alt shortcuts. See [Terminal Setup](terminal-setup.md) for the Windows alternatives.

## Change the model or settings

Type `/` to search the available commands. The commands you will use most often are:

- `/model` selects a model, then how much reasoning it uses. Press `Ctrl+L` to open the same selector, or `Shift+Tab` to cycle through thinking levels.
- `/login` and `/logout` manage provider access.
- `/settings` changes common preferences.

Prompt templates, skills, and extensions can add more commands to the same menu. See [Choose a Model](models.md), [Configuration](configuration.md), or the complete [Slash Commands reference](slash-commands.md).

## Continue or start over

AkramCode saves sessions automatically unless session persistence is disabled.

- `/clear` starts a new session.
- `/rename` gives the current session a recognizable name.
- `/usage` shows its file, ID, message count, token usage, and cost.

Use `/fork` when you want to explore another approach without losing existing work. Use `/compact` to reduce the conversation history sent to the model. See [Sessions and Context](sessions.md) for these workflows.

After leaving AkramCode, run `akramcode --resume` to pick a saved session and continue it.

## Run a terminal command

Prefix a command with `!` to run it and include its output in the conversation:

```text
!git status
```

Use `!!` when you want to run a command without sending its output to the model.

## Copy, export, or share results

Press `Ctrl+X` to copy the last assistant response. Use `/share` to upload the session and get a viewer link, or to save it as HTML or JSONL. Uploads create a private GitHub gist through the GitHub CLI. Review the session first because it can contain prompts, tool output, file contents, and credentials exposed during the conversation.

## Adjust the terminal

AkramCode runs fullscreen: the editor and status area stay fixed while the transcript scrolls within the terminal window.

Terminal support for mouse input, keyboard shortcuts, and inline images varies. See [Terminal Setup](terminal-setup.md) for platform-specific configuration and [Keybindings](keybindings.md) for every configurable shortcut.

## Collect diagnostic information

When troubleshooting terminal rendering or conversation state, run `/debug`. AkramCode writes the rendered terminal lines and current session messages to `akramcode-debug.log` in your [agent directory](configuration.md#agent-directory).

Review this file before sharing it. It can contain prompts, model responses, tool output, file contents, and terminal data.
