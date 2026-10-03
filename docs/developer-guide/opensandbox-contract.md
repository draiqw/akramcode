# OpenSandbox terminal backend contract

OpenSandbox is registered as an optional AkramCode backend. This document
records its lifecycle contract and configuration shape.

The two execution modes are selected through the existing
`terminal.backend` setting:

```yaml
terminal:
  backend: local
```

`local` is the default and executes commands on the machine that runs
AkramCode, using the selected working directory. Sandbox mode will select
`opensandbox` through the same setting. Its service connection settings should
live under `terminal.opensandbox` (`server_url`, optional `api_key`, image,
resource limits, TTL, egress policy, and persistent workspace setting); exact
field names remain subject to the future backend implementation.

## Lifecycle contract

- A sandbox identity is scoped by both the owning user/profile and stable
  conversation/session ID. A transient Python object ID is not a valid key.
- A running sandbox can be reconnected by its server-issued sandbox ID.
- `/workspace` is backed by a named persistent volume derived from the scoped
  identity. Killing or expiring the sandbox keeps that volume; creating a new
  sandbox for the same identity mounts it again.
- Different owners or sessions never share a volume.
- Commands renew the sandbox TTL before execution. A transport failure must
  not trigger blind re-execution of a command whose result is unknown.
- Cleanup ends the live sandbox according to lifecycle policy and retains the
  volume. Volume deletion requires an explicit retention/cleanup policy.
- This contract preserves workspace files only. Processes, memory, installed
  packages outside `/workspace`, and runtime checkpoints are not promised.

`tests/tools/environments/test_execution_modes_contract.py` checks local mode
against the real host backend. OpenSandbox lifecycle tests should use a
stateful SDK fake and must also cover reconnecting a session to its persistent
workspace.
