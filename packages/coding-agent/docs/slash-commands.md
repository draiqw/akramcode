# Slash commands

Type `/` in AkramCode's terminal editor to search the commands available in the current session. This page lists the built-in commands in the current AkramCode release.

Extensions, prompt templates, and skills can add commands. The command menu in AkramCode is therefore the exact reference for the resources loaded in your session.

## Models and settings

| Command | Description |
|---|---|
| `/settings` | Open settings |
| `/model [provider/model]` | Select a model, then its thinking level |
| `/login [provider]` | Add provider authentication |
| `/logout` | Remove provider authentication |

## Sessions and context

| Command | Description |
|---|---|
| `/clear` | Start a new session |
| `/rename [name]` | Rename the session, or show the current name when omitted |
| `/skills [name] [request]` | Run a skill; without a name, pick one from a list |
| `/usage` | Show the current session (file, messages, cost by model, prompt cache) and usage across all sessions: a daily activity graph and token and cost totals over 7, 30, and 90 days and all time, at API prices |
| `/fork` | Create a new session from an earlier user message |
| `/compact [instructions]` | Compact the current context, optionally with custom instructions |

## Export and share

| Command | Description |
|---|---|
| `/share [path]` | Share the session as a secret GitHub gist with a viewer link, or export it to an HTML or JSONL file. Without a path, asks which one |
| `/bug [description]` | Prepare a private bug report for the AkramCode developers |

Review a session before exporting or sharing it. Sessions can contain prompts, tool arguments, command output, file contents, and credentials exposed during the conversation.


## Runtime and project

| Command | Description |
|---|---|
| `/agents` | List, create, edit, and delete [agent types](subagents.md#custom-agent-types) |
| `/tasks` | Inspect and stop [background commands and monitors](subagents.md#background-tasks) |
| `/reload` | Reload keybindings, extensions, skills, templates, themes, and context files |
| `/quit` | Exit AkramCode. `Ctrl+D` on an empty editor and `Ctrl+C` twice also exit |

## Commands added by resources

- Extensions can register commands with their own arguments and completion behavior.
- Each prompt template is available under its template name.
- Skills run through `/skills name` (or `/skill:name`) when skill commands are enabled. They are not listed one by one in the command menu.

Use `/reload` after adding or changing a discovered command resource. See [Extensions](extensions.md), [Prompt Templates](prompt-templates.md), and [Skills](skills.md) for their loading and naming rules.
