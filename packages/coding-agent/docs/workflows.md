# Workflows

A workflow is a saved [codemode](codemode.md) script with parameters: the same tool calls in the same order every time, without a model deciding each step. Use one for a task you repeat, such as collecting release notes or checking a deployment.

## Write a workflow

A workflow is a file `<name>.workflow.js` in one of these directories:

- `~/.akramcode/agent/workflows/` for your own workflows.
- `.akramcode/workflows/` in a project. These load only when the project is trusted, and a project workflow cannot replace one of yours with the same name.

The file starts with a `/* @workflow { ... } */` comment that holds a JSON manifest, followed by the script:

```js
/* @workflow {
  "description": "Summarize the commits since a tag",
  "params": {
    "since": { "type": "string", "required": true, "label": "Start tag" },
    "max": { "type": "number", "default": 50 }
  },
  "tools": ["bash", "write"]
} */
const log = await step("git-log", () =>
  tools.bash({ command: `git log --oneline -n ${params.max} ${params.since}..HEAD` }));
check(log.output.trim() !== "", `no commits since ${params.since}`);
const notes = await step("summarize", () =>
  llm({
    prompt: "Group these commits under Added, Changed, and Fixed as Markdown:\n{log}",
    input: { log: log.output },
    schema: { type: "object", required: ["markdown"], properties: { markdown: { type: "string" } } },
  }));
if ((await ask({ question: "Write NOTES.md?", options: ["yes", "no"], default: "no" })) === "yes") {
  await step("write", () => tools.write({ path: "NOTES.md", content: notes.markdown }));
}
return notes.markdown;
```

Manifest fields:

| Field | Meaning |
|---|---|
| `description` | Shown in `/workflow` and to the agent. Required. |
| `params` | Parameters by name. Each has `type` (`string`, `number`, `boolean`, or `list`), and optionally `required`, `default`, `label`, and `description`. A required parameter has no default. |
| `tools` | The tools the script may call, by name, for example `mcp__github__create_release`. Calls to other tools fail. The tools must be callable in the session, as for codemode. |

A parameter with `"secret": true` and `"env": "GITHUB_TOKEN"` is read from that environment variable and cannot have a default. Its value is replaced with `***<name>***` (also in its JSON-escaped form) in the run record, step names, the output, and the arguments, results, and errors of tool calls as the session records them and reports them in `tool_execution_*` events. Tools still receive the real value.

## Script globals

Scripts have everything codemode scripts have, plus:

| Global | Purpose |
|---|---|
| `params` | The parameter values, converted to their types. |
| `step(id, fn)` | Runs `fn` as a named step. The run record lists each step with its status and duration. |
| `llm({ prompt, input?, schema?, model? })` | One model call without tools. `{name}` in `prompt` is replaced with `input.name`. With a JSON `schema`, the reply is parsed and checked and the value is returned; otherwise the text. `model` is `"provider/id"`; the default is the session's model. |
| `check(condition, message)` | Fails the run, and the current step, when `condition` is falsy. |
| `ask({ question, options?, default? })` | Asks the user and returns the answer. Without a UI it returns `default`, or the run ends with `needs input`. |

A tool call that fails, including a `bash` command with a non-zero exit code, rejects, so the step and the run fail unless the script catches the error. Tool calls go through the normal tool pipeline: extension hooks, permission checks, and the sandbox apply as to the model's own calls.

## Run and check

```text
/workflow                                  pick a workflow, then run, dry-run, or check it
/workflow run release-notes since=v1.0.26  run it
/workflow run release-notes since=v1.0.26 --dry
/workflow check release-notes              check it without running
```

Values with spaces are quoted: `title="Release 2"`. Lists are comma-separated: `tags=a,b`. A missing required value is asked for when there is a UI.

While a workflow runs, the footer shows its current step. The result is one line in the conversation, such as `workflow release-notes completed · 3 steps · 4.2s`; press `Ctrl+O` to see the steps, tool calls, and output. The result is also sent to the agent, so you can continue from it in the chat. `akramcode -p "/workflow run release-notes since=v1.0.26"` runs a workflow without the interactive UI.

`--dry` does not call tools that may change anything: a tool without `readOnlyHint: true` (see [tool annotations](extensions.md#tool-exposure)) returns `{ dry_run: true, tool, arguments }` instead. `read`, `grep`, `find`, and `ls` are read-only; `bash` and `write` are not. MCP tools always count as writing, because their annotations come from the server. `llm()` and `ask()` still run.

`/workflow check` reports, without running anything:

- manifest errors and JavaScript syntax errors;
- `tools.X` calls to tools missing from `tools`, listed tools that the session does not have or that are not active, and listed tools that are never called;
- `PARAM_NOT_USED`: a parameter the script never reads, so changing it would change nothing.

A listed `mcp__` tool whose server is not connected is reported as `not checked` rather than ok.

## Workflows from the agent

When workflows exist, the agent gets a `workflow_run` tool whose description lists them, and can run one with parameters or as a dry run. In the interactive UI, running a workflow that lists a tool without `readOnlyHint` asks you first, showing the parameters, unless it is a dry run. Without a UI (print and JSON modes) it runs without asking. The list in the tool description is read when the session starts, so run `/reload` after adding a workflow; edits to an existing workflow apply on its next run.
