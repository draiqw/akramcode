# AkramCode: local and OpenSandbox terminal modes

## Goal

AkramCode must support two explicit execution modes:

- `local`: commands run on the machine where AkramCode is running, like Claude Code;
- `sandbox`: commands run in an Alibaba OpenSandbox environment with a persistent workspace.

The existing `terminal.backend` setting remains the single selector. `local` is the default;
`opensandbox` is the sandbox backend. One-shot CLI overrides `--local` and `--sandbox` must
override the configured backend without rewriting user configuration.

## Architecture

OpenSandbox is added as a `BaseEnvironment` implementation and registered through the existing
terminal backend factory. The ordinary local backend and all existing remote backends remain
available. The OpenSandbox SDK is an optional dependency, so local installations do not need
the SDK or an OpenSandbox server.

The backend owns one live sandbox per stable session owner. It reconnects to a healthy live
sandbox when possible. If the sandbox expires or is unavailable, it creates a new sandbox with
the same persistent volume and restores the working directory from that volume.

The persistent volume stores the session workspace only. It does not promise to preserve running
processes, system packages, RAM, or changes outside the mounted workspace. Checkpoint/restore is
explicitly deferred because AIVA's implementation depends on an OpenSandbox fork, `runsc`,
containerd and host provisioning.

## Configuration

The backend uses the existing `terminal.backend` key:

```yaml
terminal:
  backend: local
```

or:

```yaml
terminal:
  backend: opensandbox
  opensandbox:
    server_url: http://127.0.0.1:8080
    api_key: ${OPENSANDBOX_API_KEY}
    image: akramcode-sandbox
    persistent: true
    idle_ttl_minutes: 20
    egress_mode: packages
```

The server URL, image, TTL, resource limits and egress policy are explicit configuration. Secrets
remain in the profile secret store or environment references. No AIVA-specific environment names,
Redis registry, Celery cleanup, labels or filesystem paths are copied.

## Lifecycle and safety

The session/conversation key and owner identity are passed explicitly to the backend. A single
session cannot concurrently attach two sandboxes to one volume. Reconnection is allowed only
after ownership and health checks. A network error must not blindly retry a command that may
already have executed; only a confirmed lost exec session may be retried.

## Validation

Contract tests cover local execution, stable session-to-sandbox mapping, reconnect with the same
workspace, isolation between sessions, infrastructure failure recovery, and TUI/ACP resume
preserving the session key. Tests use a stateful fake SDK/transport; a real OpenSandbox server is
reserved for an integration lane.
