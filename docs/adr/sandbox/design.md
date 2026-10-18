# Sandbox provider layer

Source: packages/sandbox/src, packages/coding-agent/src/core/sandbox-tools.ts

## Tools plug in through their `operations`

The sandbox replaces the `operations` of the built-in tools; the tools themselves are unchanged. `sandboxToolsOptions` builds the options, `AgentSession._withSandbox` merges them in, and `executeBash` falls back to the sandbox shell for `!` commands. Extensions that register their own tools are not affected.

## The workspace is mounted at the host path

The session folder is mounted at the same absolute path inside the sandbox, as a bind mount (`mount`) or a named volume (`volume`). Tools resolve paths against the session `cwd` on the host, so no path translation exists to get wrong, and the system prompt and session header stay correct.

## Mount mode runs only commands remotely

In `mount` mode the sandbox sees the same files as the host, so `read`, `write`, `edit`, `grep`, `find` and `ls` stay local, which is faster and keeps ripgrep and fd working. In `volume` mode the host files are not visible, so every file tool goes through the sandbox file API. `grep` cannot (it spawns local ripgrep) and tells the model to use `bash`.

## Reuse follows aiva's design, minus what needs gVisor

A released sandbox stays alive for `idleMinutes` and is found again by labels (session, owner, workspace mode, folder hash). A per-session file lease stops two processes from driving one sandbox; the loser gets a throwaway one. The workspace volume outlives the sandbox. Checkpoints are not used: they need gVisor, which a Mac does not have, and aiva keeps them off by default too.

## Metadata values are short and restricted

The server accepts metadata values of at most 63 characters from `[A-Za-z0-9-_.]`. The folder is therefore stored as a 16 character hash of its path, and names are reduced to a safe slug.

## The `sandbox` setting is global-only

A project settings file must not choose the server that executes commands, so `getSandboxSettings` reads global settings only.

## Volumes are deleted through fork endpoints

Upstream OpenSandbox has no volume list or delete API. The aiva fork adds `/v1/volumes`; the client calls it directly, with the `OPEN-SANDBOX-API-KEY` header, and keeps its own ledger of last use because the server does not report it.
