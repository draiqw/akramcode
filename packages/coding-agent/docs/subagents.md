# Subagents and background tasks

AkramCode can delegate work to subagents and run long commands in the background. The model decides when to use them; you can ask for them directly, for example "use the explore agent to find where sessions are saved" or "run the test suite in the background".

## Subagents

The `agent` tool starts a subagent: a separate agent session inside the same AkramCode process. The subagent gets a fresh context, its own system prompt, and its own tool list. It does not see the conversation; the main agent writes it a self-contained prompt. Only the subagent's final message returns to the main agent.

Parameters:

| Parameter | Description |
|---|---|
| `description` | Short (3-5 word) description shown in the transcript |
| `prompt` | The task |
| `subagent_type` | Agent type, default `general-purpose` |
| `model` | Optional model override (`provider/model-id` or a pattern, as for `--model`) |
| `run_in_background` | Return at once; the result arrives as an [agent notification](#agent-notifications) |

Each agent gets an id (`a1`, `a2`, ...). A foreground call returns the agent's final message followed by `agent_id: a1`; a background call returns the id at once. Several `agent` calls in one assistant message run concurrently. Aborting the main agent (`Escape`) aborts its foreground subagents.

### Messaging agents

An agent keeps its conversation after it finishes, so it can be given more work with its full context:

- The main agent calls `agent_message` with `agent_id` and `message`. A running agent reads the message after its current step (like a steering message). A finished agent continues in the background, and its reply arrives as an [agent notification](#agent-notifications).
- You write to an agent from its chat (see below). The main agent is notified of the reply, together with your message, so it knows what you agreed with the agent.

`task_stop` with an agent id stops a running agent.

### In the terminal

In the chat, an agent call is its own line, never folded into a tool group: `● Agent "Find config files" · explore`, then `⎿ Running · 1m 12s · 12k tokens` with the latest tool calls while it runs, and `⎿ Finished · 1m 40s · 18k tokens` with the first lines of its report when it is done. Expand tool output (`Ctrl+O`) to read the whole report and the transcript path. A background agent shows `⎿ Started in background · a1`; when it finishes, a separate line reports it: `● Agent "Find config files" finished · 1m 40s · 18k tokens`.

Below the editor, a panel lists agents, one line each: type, description, running time, and tokens, for example `● explore: find config files · 1m 12s · 12k tokens`. Running agents are listed first; a finished one (`✓`, or `✗` when it failed or was stopped) disappears, unless its chat is open; then it stays until you leave that chat. At most five lines are shown.

Switching between the main chat and an agent's chat works the same way in both directions:

- `Down` in an empty editor selects a line in the panel (the hint `down to switch chat` says so). While selecting, a `main chat` line leads the list, and the chat shown now is marked `· open`. `Up`/`Down` move, `Enter` opens, `x` stops a running agent, `Escape` (or `Up` on the first line) returns to the editor. In fullscreen mode a click on a line opens it.
- An agent's chat replaces the main chat: its prompt, messages, and tool calls, updated live while it runs. A line right above the editor names the agent you are writing to, with its state and the keys: `escape for main chat · down to switch`. Messages you send go to the agent; slash commands still go to AkramCode.

Subagents:

- can never do more than the main session: they get only tools the main session can call itself, and each of their tool calls runs in the main session as a nested call (`ctx.executeTool()`). Extension `tool_call` and `tool_result` hooks, permission checks, the working directory, and the [sandbox](sandbox.md) of the main session apply to them; hooks see the call with `parentToolCallId` set to the `agent` call;
- receive the project's context files (`AGENTS.md`) and a short system prompt with the date and their type's instructions, not the main system prompt, skills, or prompt templates;
- never get the `agent`, `agent_message`, or `task_stop` tools, and their `bash` has no background options, so they cannot start further agents or background work;
- save their transcript next to the session file, in `<session>.subagents/` (mode 0700), or, for sessions without a file, in a private temp directory that is deleted when the session ends.

### Built-in agent types

| Type | Tools | Use |
|---|---|---|
| `general-purpose` | The main agent's active tools | Multi-step research and changes |
| `explore` | `read`, `grep`, `find`, `ls`, `bash`, as far as they are active in the main session | Read-only code search; its prompt forbids changes |

### Custom agent types

An agent type is a Markdown file with YAML frontmatter. The body is the type's system prompt.

| Location | Scope |
|---|---|
| `~/.akramcode/agent/agents/*.md` | User agents, in every project |
| `.akramcode/agents/*.md` | Project agents |

Extensions can add types too (see [Extensions](extensions.md#agent-types)), such as the built-in [`browser`](browser.md) type. A user agent can replace a built-in or extension type with the same name. `subagents.models` in [settings](settings.md) sets the model of any type by name, for example `"subagents": { "models": { "browser": "openai-codex/gpt-6-luna" } }`. A project agent cannot replace a built-in or user agent: it is skipped and reported as a warning, so a repository cannot change what an agent type you rely on does.

| Field | Required | Description |
|---|---|---|
| `name` | yes | Type name for `subagent_type`: letters, digits, `-`, `_`, `.` |
| `description` | yes | When the main agent should use this type. The `agent` tool lists it. |
| `tools` | no | Allowlist, as a comma-separated string or a YAML list. Default: the main agent's active tools. |
| `disallowedTools` | no | Denylist applied after `tools`, same syntax |
| `model` | no | Model (`provider/model-id` or a pattern). Default `inherit`: the main agent's model. |
| `thinking` | no | Thinking level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Default `inherit`. |

Tool names refer to tools of the main session: built-in tools, extension tools, and MCP tools (named `mcp__<server>__<tool>`). `*` matches any characters, so `mcp__github__*` selects every tool of the `github` server. The allowlist only selects among the tools the main session can call itself:

- tools active in the main session (disabled with `--tools`, `defaultTools`, or `excludeTools`, or registered inactive, such as `update_plan`, they are not available);
- tools with `codemode` exposure while `codemode` is active;
- tools with `deferred` exposure, such as the [browser](browser.md) tools and MCP tools of `deferred` servers. Types that list them get them. Types without a `tools` list get only those that `tool_search` has already loaded in the main session.

`codemode`, `tool_search`, `agent`, `agent_message`, `task_stop`, and hidden tools are never given. The subagent gets exactly the resolved tools: the list is enforced when its session is created, not only described in its prompt. Names that match no available tool are ignored and reported as warnings at startup and in `/agents`. Built-in types are not reported for missing tools, because they name optional tools on purpose (`explore` lists `grep`, `find`, and `ls`, which are off by default). MCP servers connect after startup, so unmatched `mcp__` names are reported only in `/agents`. Starting a type whose `tools` name a server's tools (such as `mcp__github__*`) waits until that server has connected or failed, so the subagent does not start without them.

Example: a read-only reviewer.

```markdown
---
name: reviewer
description: Reviews the current diff for bugs and risky changes. Use after making changes.
tools: read, grep, find, ls, bash
disallowedTools: edit, write
thinking: high
---

Review the uncommitted changes (`git diff`). Report only real problems: bugs, missing error handling,
security issues. Give file paths and line numbers. Do not modify files.
```

Example: a test runner limited to `bash` and `read`.

```markdown
---
name: test-runner
description: Runs the test suite and summarizes failures with their likely cause.
tools: [bash, read]
model: openai/gpt-5-mini
---

Run the project's tests. For each failure, read the failing test and the code under test and
explain the likely cause in two sentences. Report the exact command you ran.
```

Example: an issue triager that uses one MCP server.

```markdown
---
name: triager
description: Triages GitHub issues using the github MCP server.
tools: read, mcp__github__*
disallowedTools: mcp__github__create_*
---

Read the issues you are given, find duplicates and related code, and propose labels.
```

### Manage agent types with `/agents`

`/agents` lists the built-in, user, and project agent types with the tools each one gets in the current session, and any warnings. Select a type to see its fields and prompt; user and project types can be edited (system prompt) or deleted there.

**Create new agent** asks for:

1. the scope: project (`.akramcode/agents`) or user (`~/.akramcode/agent/agents`);
2. the name and description;
3. the tools, picked from the session's tool list (no selection gives the main agent's tools);
4. an optional model and thinking level;
5. the system prompt, in the editor.

The file is written and the agent type is available at once, without a restart. Files you edit by hand are read again on `/reload` or in a new session.

## Background tasks

A background task is a shell command that runs while the conversation continues. Agents are not tasks: they have their own panel (see [Subagents](#in-the-terminal)). There are two kinds:

| Kind | Started by | Id |
|---|---|---|
| Background command | `bash` with `run_in_background: true` | `b1`, `b2`, ... |
| Monitor | `bash` with `run_in_background: true` and `monitor: true` | `m1`, ... |

Each task writes its output to `<task id>.output` in a private directory of the session under the temp directory (`akramcode-tasks-<random>`, mode 0700; files 0600, never written through an existing file or symlink). The directory is deleted when the session ends. The tool result names the file; the model reads it with the `read` tool.

An output file holds at most 64 MiB; after that a note marks the limit and later output is discarded while the task keeps running. Output that arrives faster than the disk accepts it is dropped and replaced by a note with the number of dropped bytes, so a command like `yes` cannot fill memory.

The `task_stop` tool stops a task by id. The model is not notified about tasks it stops itself.

### Monitor

A monitor is a background `bash` command with `monitor: true`. It delivers each line the command prints to the model, until the command exits, the timeout passes (`timeout` in seconds, default 300), or the task is stopped. Because it is a mode of `bash`, it exists only when `bash` is enabled, and the shell command prefix, spawn hooks, and extension hooks of `bash` apply to it, as they do to every background command. Use line-buffered output in pipes, for example `tail -f server.log | grep --line-buffered ERROR`. Lines are batched: at most one delivery every 2 seconds, at most 40 lines per delivery; the rest are counted and stay in the output file.

### Task notifications

When a task finishes, and for each monitor batch, the session receives a `task-notification` message. It names the task, its status (`completed`, `failed`, or `stopped`), and its output file, and carries the last 20 output lines of commands. The message starts a turn when the agent is idle, or is delivered after the current turn when it is working, so the model reacts in both cases. Notifications that arrive during a turn are delivered together in the next turn. Notifications that arrive during compaction are delivered when it ends.

After you interrupt a run (`Escape`, or `abort` in RPC mode), notifications no longer start turns; aborts by `/compact` or extensions do not pause them. They wait and are sent ahead of your next message, which resumes normal delivery (also when that message is queued during a run; messages from extensions do not resume it); of monitor output, only the newest five notifications are kept. Stop a task with `/tasks` if you no longer need it.

In the transcript a notification is one line, for example `● task b1 (bash: npm test) completed · exit 0 · 12s`; expand tool output to see its content.

### Agent notifications

When an agent run that the main agent did not wait for ends (a background agent, an agent continued with `agent_message`, or an agent you wrote to), the session receives an `agent-notification` message with the agent id, its status, its reply, the transcript path, and, when you started the run, your message. It is delivered like a task notification: it starts a turn when the main agent is idle and follows the same rules after an interrupt and during compaction. An agent stopped with `task_stop` sends none.

### Monitoring in the terminal

- The footer shows the number of running tasks, for example `2 tasks running`.
- `/tasks` lists the tasks of the session with status, kind, description, and elapsed time. Select a task to see its details and the tail of its output, refresh it, or stop it. A task you stop from `/tasks` notifies the model.

### Lifecycle

- All running tasks and agents are stopped when the session ends: on exit, `/clear`, `/fork`, and other session switches.
- In print mode (`-p`, `--mode json`), AkramCode waits for running tasks and background agents after the prompt and lets the model react to their notifications, so the printed answer includes their results. After `backgroundTasks.printModeTimeoutSeconds` (default 600) it stops the remaining work and exits.

## Extensions

Extensions reach the session's tasks through `ctx.tasks` (a `TaskRegistry`): `list()`, `running()`, `get(id)`, `stop(id)`, `subscribe(listener)`, and `create()`, which registers a task of their own with an output file; finishing it sends the usual task notification. `ctx.subagents` lists agent types and the tools they resolve to, and `reload()` reads the definitions again. Task and agent notifications are custom messages with `customType: "task-notification"` and `"agent-notification"`; an extension can replace their rendering with `registerMessageRenderer`. The built-in `tasks` extension provides the footer status, `/tasks`, `/agents`, and the default rendering.

## Settings

| Setting | Default | Description |
|---|---|---|
| `subagents.enabled` | `true` | Offer the `agent` and `agent_message` tools and `/agents` |
| `backgroundTasks.enabled` | `true` | Offer `run_in_background` and `monitor` on `bash`, `run_in_background` on `agent`, and `task_stop` |
| `backgroundTasks.printModeTimeoutSeconds` | `600` | How long print mode waits for running tasks |

Settings take effect for new sessions and after `/reload`. `agent`, `agent_message`, and `task_stop` are part of the default tools: `--tools` and a [`defaultTools`](settings.md#tools) list of plain names replace them, so name them there to keep them (`--tools read,bash,agent`), and `"defaultTools": ["-agent"]` removes one.

## Limitations

- Subagents share the main process: a subagent that runs a heavy command slows the main session like any tool call.
- Built-in read-only tools that are not active in the main session (`grep`, `find`, `ls` by default) are not available to `explore`; it searches with `bash` instead. Add them with `"defaultTools": ["+grep", "+find", "+ls"]`.
- Background task output files are on the local machine. With a remote [sandbox](sandbox.md) the `read` tool reads the sandbox's files, so read output files with `/tasks` instead.
