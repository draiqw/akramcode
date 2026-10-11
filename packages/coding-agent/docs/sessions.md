# Sessions and Context

AkramCode saves a conversation as a session. The active branch of that session supplies conversation history for the next model request. Use session commands to continue work, explore another branch, or reduce the amount of history sent to the model.

## Continue or switch sessions

AkramCode saves sessions automatically unless you start it with `--no-session`.

```bash
akramcode --resume
```

`--resume` opens the session picker. In interactive mode, `/clear` starts a new session.

Use `/rename` or `--name` to assign a recognizable session name. Run `/usage` to verify the current session file, ID, message count, token usage, and cost.

The session picker lets you search, rename, and delete sessions. It can also show paths, change sorting, and limit results to named sessions. See [Keybindings](keybindings.md#sessions) for its shortcuts.

## Choose how to branch

AkramCode stores entries as a tree, so returning to an earlier point does not erase the branch you leave.

Use `/fork` to pick an earlier user message and start a new session from it. The original session stays unchanged.

When tree navigation (extensions or SDK `navigateTree`) leaves a branch, AkramCode can summarize it and attach that summary to the branch it enters. This preserves relevant work from the abandoned path without including every message from it.

For the persisted tree and entry types, see [Session Format](session-format.md).

## Manage conversation context

The model receives the active branch, not every branch in the session file. AkramCode combines that history with the system prompt, discovered context files, available tools, and loaded skill descriptions. [How AkramCode Works](how-akramcode-works.md#context) describes how those inputs are assembled.

The footer shows current context usage. When the active context approaches the model's limit, AkramCode normally compacts older history automatically. Compaction adds a summary and keeps recent messages. It does not delete the original session entries.

Run `/compact` to compact manually. You can add instructions when the summary should preserve a particular topic or decision. Configure automatic compaction and retained history through [Settings](settings.md#compaction).

Compaction can fail if the provider is unavailable or cannot accept the summarization request. Correct the provider problem and run `/compact` again. Disabling automatic compaction does not disable the manual command.

See [Compaction Reference](compaction.md) for thresholds, retained boundaries, branch-summary behavior, and extension hooks.

## Control session storage

By default, AkramCode stores sessions under `~/.akramcode/agent/sessions/`, grouped by working directory. Use `--session-dir`, `AKRAMCODE_CODING_AGENT_SESSION_DIR`, or the `sessionDir` setting to choose another location. The CLI option has highest precedence.

Use `--no-session` for an ephemeral run. An ephemeral session cannot be resumed after AkramCode exits.

Use `--session` when you already know the session path or ID. Use `--fork` to create a new session from an existing session before interactive mode starts.

## Export or share a session

Use `/share` to upload the current session as a private GitHub gist and get a viewer link, or to write it as HTML or JSONL. Run `akramcode --import <file.jsonl>` to copy an exported JSONL session into the current project and resume it.

Review exported or shared sessions first. They can contain prompts, model responses, tool arguments, command output, file contents, and extension messages.

## Report a bug

Run `/bug [description]` to prepare a bug report as a zip archive. You can include the session transcript, omit it, or ask the current model to summarize the problem. Review any transcript or generated summary because it can contain sensitive conversation data.

The report includes environment and provider configuration without credential values, plus recorded error diagnostics. The zip is written to the current directory; nothing is uploaded, so you can inspect it and share it yourself.
