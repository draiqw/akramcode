# Run AkramCode safely

Treat model-generated commands and code as untrusted. AkramCode can read, change, and execute files with the permissions of the account that started it, and it does not ask for approval before every tool call. It asks only before [commands that cannot be undone](#commands-that-always-ask). Extensions, package installers, language servers, and other child processes run with those same permissions unless an operating-system or virtualization boundary restricts them.

Files, comments, instructions, command output, and model responses can steer the model through prompt injection.

Safety comes from limiting the files, credentials, processes, and network services AkramCode can access and affect if a generated action is wrong or hostile. Watching the transcript and reviewing changes do not create a security boundary.

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
- rewriting git history, deleting refs, or discarding changes: `git push --force` (also `-f`, `--force-with-lease`, `+branch`, `--mirror`, `--prune`), `git push --delete` (also `:branch`), `git reset --hard`, `git clean -f`, `git checkout -- <path>`, `.`, `-f`, or `-B`, `git switch --discard-changes`, `git restore` (except `--staged` alone), `git rm` (except `--cached`), `git branch -D` or `-f`, `git stash drop` or `clear`, `git update-ref -d`, `git reflog expire`, `git gc --prune`, `git filter-branch` or `filter-repo`, `git worktree remove --force`;
- system-level: `sudo`, `doas`, `dd of=`, `mkfs`, `diskutil erase`.

It applies to every `bash` call, including calls made by subagents, codemode scripts, and workflows, and it runs after extension hooks, so a hook cannot change a command after you approved it. Commands you run yourself with `!` are not checked, nor are tools under other names, such as an MCP server's shell tool. When you decline, the agent stops after its current tool calls, unless other calls among them went through.

The check matches command text: line continuations are joined, and quotes and backslashes are ignored, so `r''m` and `bash -c "rm x"` ask too. A program that deletes files on its own, such as a Python script, is not caught. It reduces accidents; it is not a security boundary.

<a id="project-resources"></a>

## Project resources load without asking

AkramCode loads everything a working folder supplies, without a prompt:

- `.akramcode/settings.json` and `.akramcode/mcp.json`
- extensions, skills, prompt templates, themes, agents, workflows, `SYSTEM.md`, and `APPEND_SYSTEM.md` under `.akramcode`
- project `.agents/skills` in the current directory or an ancestor directory
- packages configured in project settings, which are installed when missing
- context files such as `AGENTS.md` and `CLAUDE.md`

Project extensions and packages run code in the AkramCode process, and project MCP servers can start commands. Start AkramCode only in folders whose `.akramcode` and `.agents` contents you accept, or run it in an [isolated environment](containerization.md).

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
