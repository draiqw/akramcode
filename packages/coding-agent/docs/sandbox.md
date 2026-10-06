# Run Tools in a Sandbox

By default the built-in tools run on your machine. The `sandbox` setting moves them into an [OpenSandbox](https://github.com/alibaba/OpenSandbox) sandbox: a Linux container that AkramCode creates, reuses between turns, and releases when the session ends. This limits what a wrong command can reach. It does not make model output trustworthy; see [Security](security.md).

The macOS machine itself is the default sandbox: with no `sandbox` setting, or `"provider": "local"`, nothing changes.

## Set up the server

AkramCode talks to an OpenSandbox server over HTTP. Run it where Docker runs, for example on a Mac with Docker Desktop:

```bash
cd OpenSandbox/server
uv sync
uv run opensandbox-server init-config ~/.sandbox.toml --example docker
```

In `~/.sandbox.toml` set an API key, and allow the folders that will be mounted:

```toml
[server]
api_key = "choose-a-secret"

[storage]
allowed_host_paths = ["/Users"]
managed_volume_prefixes = ["akc-"]
```

Start it with `uv run opensandbox-server`. An empty `allowed_host_paths` rejects every mount. `managed_volume_prefixes` and the `/v1/volumes` endpoints exist only in the aiva fork of OpenSandbox; without them the volume sweep reports volumes it cannot delete and leaves them in place.

## Enable the sandbox

The `sandbox` block is read from user settings only (`~/.akramcode/agent/settings.json`). A project cannot move command execution to another server.

```json
{
  "sandbox": {
    "provider": "opensandbox",
    "workspace": "mount",
    "opensandbox": {
      "domain": "127.0.0.1:8080",
      "apiKey": "$OPENSANDBOX_API_KEY"
    }
  }
}
```

`apiKey` accepts a literal, `$NAME` or `!command`.

| Setting | Default | Description |
|---|---|---|
| `provider` | `local` | `local` runs tools on this machine; `opensandbox` runs them in a sandbox. |
| `workspace` | `mount` | `mount` bind-mounts the session folder into the sandbox at the same path: commands run in the sandbox on the real project files, and `read`, `write`, `edit` keep working on the host. `volume` keeps the workspace in a named volume per session; the project is not exposed and every file tool runs in the sandbox. |
| `opensandbox.domain` | `127.0.0.1:8080` | Server address. |
| `opensandbox.protocol` | `http` | `http` or `https`. |
| `opensandbox.apiKey` | none | Sent as `OPEN-SANDBOX-API-KEY`. |
| `opensandbox.image` | `python:3.12-slim` | Image of the sandbox. Use an image with the tools your work needs. |
| `opensandbox.cpu`, `opensandbox.memory` | `2`, `4Gi` | Resource limits. |
| `opensandbox.ttlMinutes` | `330` | Lifetime of a sandbox the session holds. Must exceed your longest run. |
| `opensandbox.idleMinutes` | `20` | How long a released sandbox waits for the next turn. |
| `opensandbox.maxLive` | `12` | Most reusable sandboxes alive at once; the longest idle are deleted first. |
| `opensandbox.volumePrefix` | `akc-` | Prefix of the volumes AkramCode creates. Keep it in the server's `managed_volume_prefixes`. |
| `opensandbox.volumeRetentionDays` | `30` | Volumes untouched for this long are deleted by a daily sweep. |
| `opensandbox.network` | `allow` | `deny` blocks all outbound traffic from the sandbox (needs the server's egress sidecar image). |

## What is reused

- **Sandbox per session.** A sandbox is labelled with the session id, the owner, the workspace mode and the folder. When a session starts, a matching running or paused sandbox is attached instead of created: about 40 ms against about 1 s for a new one on a Mac. A paused sandbox is resumed, and one whose workspace is not writable is deleted and replaced.
- **Lease.** Only one AkramCode process drives a session's reusable sandbox. A second process on the same session gets a throwaway sandbox that is deleted on release. A lease whose process has died is taken over.
- **Persistent shell.** Commands of a session run in one shell session of the sandbox, so a command is one request rather than a process start.
- **Volumes.** In `volume` mode the workspace survives the sandbox: it is mounted again whenever the session resumes (`akramcode --continue`). Volumes untouched for `volumeRetentionDays` are removed.
- **Eviction.** On release the sandbox stays for `idleMinutes`; beyond `maxLive` the longest idle are deleted.

## Limits

- `grep` does not reach files in `volume` mode; use `rg` or `grep` through `bash`. In `mount` mode `grep` and `find` read the host files.
- `bash` receives only `AKRAMCODE_SESSION_ID`, `AKRAMCODE_PROVIDER`, `AKRAMCODE_MODEL` and `AKRAMCODE_REASONING_LEVEL`. Credentials, `AKRAMCODE_SECRETS_KEY`, `PATH` and the rest of the host environment are not forwarded.
- Snapshots and checkpoints are not used. The gVisor checkpoint backend of the fork needs a Linux host with gVisor, which macOS does not provide.
- The sandbox image decides which tools exist inside. `python:3.12-slim` has no `git` or `rg`.
