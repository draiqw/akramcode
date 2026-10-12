# Run AkramCode safely

Treat model-generated commands and code as untrusted. AkramCode can read, change, and execute files with the permissions of the account that started it, and it does not ask for approval before every tool call. It asks only before [commands that cannot be undone](#commands-that-always-ask). Extensions, package installers, language servers, and other child processes run with those same permissions unless an operating-system or virtualization boundary restricts them.

Files, comments, instructions, command output, and model responses can steer the model through prompt injection. Project trust controls which project resources load at startup, but it does not make that content or the resulting actions safe.

Safety comes from limiting the files, credentials, processes, and network services AkramCode can access and affect if a generated action is wrong or hostile. Watching the transcript, using project trust, and reviewing changes do not create a security boundary.

## Choose how to run AkramCode

Different ways of running AkramCode place different limits on what generated commands can access:

| How AkramCode runs | What remains protected |
|---|---|
| Directly, with the permissions of its operating-system user | Anything that user cannot access. A dedicated user account can narrow those permissions, but AkramCode still shares the operating system and network with other users. |
| Entirely inside a container, virtual machine, or sandbox | Host files and processes that you do not expose to the environment. Credentials and network services remain accessible if you make them available inside it. This is usually the strongest practical option. |
| Outside the isolated environment, with only its built-in tools running inside | Host resources are protected from actions performed through those tools. AkramCode itself and other extensions remain outside the boundary, so this is a narrower form of isolation. |

The working folder controls resource discovery and the default location for tools, but it does not prevent commands from accessing other paths available to the AkramCode process.

Whichever option you choose, only provide the files and services required for the task. Keep credentials outside the environment where possible, or use narrowly scoped, short-lived credentials. Restrict network access when commands do not need it.

For setup instructions and the limitations of each isolation method, see [Run AkramCode in an isolated environment](containerization.md).

## Commands that always ask

Before the `bash` tool runs one of these commands, AkramCode asks you to confirm it. No setting, project, or extension can turn this off. Without a UI (`-p`, JSON mode) the command is blocked.

- deleting or emptying files: `rm`, `rmdir`, `unlink`, `shred`, `truncate`, `find -delete`, `rsync --delete`;
- rewriting git history, deleting refs, or discarding changes: `git push --force` (also `-f`, `--force-with-lease`, `+branch`, `--mirror`, `--prune`), `git push --delete` (also `:branch`), `git reset --hard`, `git clean -f`, `git checkout -- <path>`, `.`, `-f`, or `-B`, `git switch --discard-changes`, `git restore` (except `--staged` alone), `git rm` (except `--cached`), `git branch -D` or `-f`, `git stash drop` or `clear`, `git update-ref -d`, `git reflog expire`, `git gc --prune`, `git filter-branch` or `filter-repo`;
- system-level: `sudo`, `doas`, `dd of=`, `mkfs`, `diskutil erase`.

It applies to every `bash` call, including calls made by subagents, codemode scripts, and workflows, and it runs after extension hooks, so a hook cannot change a command after you approved it. Commands you run yourself with `!` are not checked, nor are tools under other names, such as an MCP server's shell tool. When you decline, the agent stops after its current tool calls, unless other calls among them went through.

The check matches command text: line continuations are joined, and quotes and backslashes are ignored, so `r''m` and `bash -c "rm x"` ask too. A program that deletes files on its own, such as a Python script, is not caught. It reduces accidents; it is not a security boundary.

<a id="project-trust"></a>

## Understand project trust

Project trust controls whether AkramCode loads most settings and resources supplied by a working folder. It prevents a folder from silently loading executable extensions before you approve it.

Project trust is not a complete startup boundary. AkramCode reads the project `sessionDir` setting while selecting or creating a session, before it resolves project trust. Declining trust prevents the remaining project settings and protected resources from loading, but it cannot undo that initial session-directory lookup.

Project trust does not limit what tool calls can access or affect. After AkramCode starts, enabled tools still use the operating-system permissions of the AkramCode process. Instructions and other content in the folder can also influence the model.

### Resources protected by project trust

AkramCode requires a project-trust decision when it finds any of these resources from the current working directory:

- `.akramcode/settings.json`
- `.akramcode/mcp.json`
- `.akramcode/extensions`, `.akramcode/skills`, `.akramcode/prompts`, or `.akramcode/themes`
- `.akramcode/SYSTEM.md` or `.akramcode/APPEND_SYSTEM.md`
- project `.agents/skills` in the current directory or an ancestor directory

A bare `.akramcode` directory does not require project trust.

Granting project trust allows AkramCode to load:

- project settings
- project MCP servers from `.akramcode/mcp.json`
- extensions, skills, prompt templates, themes, and system-prompt files under `.akramcode`
- missing packages configured through project settings
- project-local and project-package extensions

Declining project trust skips those protected resources, except for the initial `sessionDir` lookup described above.

Context files such as `AGENTS.override.md`, `AGENTS.md`, and `CLAUDE.md` load regardless of project trust unless you disable context loading. Treat instructions in a folder as untrusted input even when you decline project trust.

### How AkramCode chooses a trust decision

A command-line `--approve` or `--no-approve` override applies first. When protected resources exist and there is no command-line override:

1. User-level and command-line extensions can handle the `project_trust` event. The first extension that returns yes or no owns the decision.
2. If no extension decides, AkramCode looks for a saved decision for the current directory or one of its parents. The closest decision applies.
3. If no saved decision applies, AkramCode follows the global `defaultProjectTrust` setting, whose default is `"ask"`.

Saved decisions use canonical directory paths and live in:

```text
~/.akramcode/agent/trust.json
```

AkramCode saves the decision you make at the startup prompt. To change it later, edit or delete the project's entry in that file.

### Project trust without an interactive prompt

Print, JSON, and RPC modes cannot show the built-in trust prompt. If no command-line override, extension, or saved decision applies:

- `defaultProjectTrust: "always"` loads protected project resources.
- `defaultProjectTrust: "ask"` or `"never"` skips them.

Use `--approve` or `--no-approve` when an automated run needs an explicit one-time decision.

## Reduce impact and improve recovery

These practices do not replace isolation, but they reduce exposure or make recovery easier:

- Give AkramCode access only to files and services required for the task.
- Use snapshots, backups, or version control before substantial changes.
- Review extensions and packages before loading them. Extensions execute inside the AkramCode process.
- Prefer narrowly scoped, short-lived credentials.
- Review diffs and generated output before applying results to another system.
- Review sessions before exporting or sharing them. They can contain prompts, tool arguments, command output, file contents, and credentials exposed during the conversation.

## Report a security issue

Follow the repository [Security Policy](https://github.com/draiqw/akramcode/blob/main/SECURITY.md). Do not open a public issue for a security-sensitive report.

Expected local-agent behavior, prompt injection from untrusted content, lack of a built-in sandbox, and behavior from user-installed extensions or skills are generally outside the security boundary unless the report demonstrates a privilege-boundary bypass or access that the local user did not already have.
