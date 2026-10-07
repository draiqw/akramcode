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
| `run_in_background` | Return at once with a task id; the result arrives as a [task notification](#task-notifications) |

Several `agent` calls in one assistant message run concurrently. Aborting the main agent (`Escape`) aborts its foreground subagents.

In the transcript an agent call shows as `agent(description)` with the subagent's latest tool calls while it runs, then a summary such as `Done (7 tool uses · 18k tokens · 42s)`. Expand tool output (`Ctrl+O`) to read the final message and the transcript path.

Subagents:

- run their tools in the main session's working directory and [sandbox](sandbox.md);
- receive the project's context files (`AGENTS.md`) and a short system prompt with the date and their type's instructions, not the main system prompt, skills, or prompt templates;
- never get the `agent`, `task_stop`, or `monitor` tools, and cannot run commands in the background, so they cannot start further agents;
- save their transcript next to the session file, in `<session>.subagents/`, or in the temp directory for sessions without a file.

### Built-in agent types

| Type | Tools | Use |
|---|---|---|
| `general-purpose` | The main agent's tools | Multi-step research and changes |
| `explore` | `read`, `grep`, `find`, `ls`, `bash` | Read-only code search; its prompt forbids changes |

### Custom agent types

An agent type is a Markdown file with YAML frontmatter. The body is the type's system prompt.

| Location | Scope |
|---|---|
| `~/.akramcode/agent/agents/*.md` | User agents, in every project |
| `.akramcode/agents/*.md` | Project agents, loaded only when the project is [trusted](security.md) |

A project agent replaces a user agent with the same name, and both replace a built-in type with the same name.

| Field | Required | Description |
|---|---|---|
| `name` | yes | Type name for `subagent_type`: letters, digits, `-`, `_`, `.` |
| `description` | yes | When the main agent should use this type. The `agent` tool lists it. |
| `tools` | no | Allowlist, as a comma-separated string or a YAML list. Default: the main agent's active tools plus the built-in tools. |
| `disallowedTools` | no | Denylist applied after `tools`, same syntax |
| `model` | no | Model (`provider/model-id` or a pattern). Default `inherit`: the main agent's model. |
| `thinking` | no | Thinking level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Default `inherit`. |

Tool names can be any tool registered in the session: built-in tools, extension tools, and MCP tools (named `mcp__<server>__<tool>`). `*` matches any characters, so `mcp__github__*` selects every tool of the `github` server. MCP tools are given to the subagent as directly declared tools, whatever their exposure in the main session (`codemode` or `deferred`); hidden tools, `codemode`, and `tool_search` are not available to subagents. Without a `tools` field, MCP tools reach the subagent only if they are active in the main session.

The subagent gets exactly the resolved tools: the list is enforced when its session is created, not only described in its prompt. Names that match no tool are ignored and reported as warnings at startup and in `/agents`. MCP servers connect after startup, so unmatched `mcp__` names are reported only in `/agents`.

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

1. the scope: project (`.akramcode/agents`, trusted projects only) or user (`~/.akramcode/agent/agents`);
2. the name and description;
3. the tools, picked from the session's tool list (no selection gives the main agent's tools);
4. an optional model and thinking level;
5. the system prompt, in the editor.

The file is written and the agent type is available at once, without a restart. Files you edit by hand are read again on `/reload` or in a new session.

## Background tasks

A background task runs while the conversation continues. There are three kinds:

| Kind | Started by | Id |
|---|---|---|
| Background command | `bash` with `run_in_background: true` | `b1`, `b2`, ... |
| Background agent | `agent` with `run_in_background: true` | `a1`, ... |
| Monitor | `monitor` tool | `m1`, ... |

Each task writes its output to a file under the temp directory (`akramcode-tasks/<session id>/<task id>.output`). The tool result names the file; the model reads it with the `read` tool. For background agents the file records the prompt, the subagent's tool calls, and the result.

The `task_stop` tool stops a task by id. The model is not notified about tasks it stops itself.

### Monitor

`monitor` runs a command and delivers each line it prints to the model, until the command exits, the timeout passes (`timeout` in seconds, default 300, maximum 3600), or the task is stopped. Use line-buffered output in pipes, for example `tail -f server.log | grep --line-buffered ERROR`. Lines are batched: at most one delivery every 2 seconds, at most 40 lines per delivery; the rest are counted and stay in the output file.

### Task notifications

When a task finishes, and for each monitor batch, the session receives a `task-notification` message. It names the task, its status (`completed`, `failed`, or `stopped`), and its output file, and carries the last 20 output lines of commands and the final message of agents. The message starts a turn when the agent is idle, or is delivered after the current turn when it is working, so the model reacts in both cases.

In the transcript a notification is one line, for example `● task b1 (bash: npm test) completed · exit 0 · 12s`; expand tool output to see its content.

### Monitoring in the terminal

- The footer shows the number of running tasks, for example `2 tasks running`.
- `/tasks` lists the tasks of the session with status, kind, description, elapsed time, and tokens of agents. Select a task to see its details and the tail of its output, refresh it, or stop it. A task you stop from `/tasks` notifies the model.

### Lifecycle

- All running tasks are stopped when the session ends: on exit, `/new`, `/resume`, `/fork`, and other session switches.
- In print mode (`-p`, `--mode json`), AkramCode waits for running tasks after the prompt and lets the model react to their notifications, so the printed answer includes their results. After `backgroundTasks.printModeTimeoutSeconds` (default 600) it stops the remaining tasks and exits.

## Extensions

Extensions reach the session's tasks through `ctx.tasks` (a `TaskRegistry`): `list()`, `running()`, `get(id)`, `stop(id)`, `subscribe(listener)`, and `create()`, which registers a task of their own with an output file; finishing it sends the usual task notification. `ctx.subagents` lists agent types and the tools they resolve to, and `reload()` reads the definitions again. Task notifications are custom messages with `customType: "task-notification"`; an extension can replace their rendering with `registerMessageRenderer`. The built-in `tasks` extension provides the footer status, `/tasks`, `/agents`, and the default rendering.

## Settings

| Setting | Default | Description |
|---|---|---|
| `subagents.enabled` | `true` | Offer the `agent` tool and `/agents` |
| `backgroundTasks.enabled` | `true` | Offer `run_in_background`, `monitor`, and `task_stop` |
| `backgroundTasks.printModeTimeoutSeconds` | `600` | How long print mode waits for running tasks |

Settings take effect for new sessions and after `/reload`. `agent`, `task_stop`, and `monitor` are part of the default tools: `--tools` and a [`defaultTools`](settings.md#tools) list of plain names replace them, so name them there to keep them (`--tools read,bash,agent`), and `"defaultTools": ["-monitor"]` removes one.

## Limitations

- Subagents share the main process: a subagent that runs a heavy command slows the main session like any tool call.
- Subagents get extension tools by definition. A tool that relies on interactive UI (`ctx.ui`) gets no UI in a subagent.
- Background task output files are on the local machine. With a remote [sandbox](sandbox.md) the `read` tool reads the sandbox's files, so read output files with `/tasks` instead.
