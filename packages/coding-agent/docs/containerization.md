# Run AkramCode in an isolated environment

Use an isolated environment to limit the files, credentials, processes, and network services that generated commands can access or affect.

You can isolate the complete AkramCode process or keep AkramCode on the host and route selected tools into an isolated environment.

## Choose an isolation method

| Method | Where AkramCode runs | What is isolated | Credential handling | Best for |
|---|---|---|---|---|
| Plain Docker | Container | AkramCode, built-in tools, `!` commands, and extensions | Credentials passed into the container | A straightforward local container boundary |
| OpenShell | Local or remote sandbox | AkramCode, built-in tools, `!` commands, and extensions | Policy-controlled credentials and inference routing | Filesystem, process, network, and credential policies |

The method changes where extensions run. When the complete AkramCode process runs inside an isolated environment, its extensions run there too.

## Decide what AkramCode can access

An isolated process can still affect resources you expose to it:

- A read-write host mount lets AkramCode modify those host files.
- Mounting `~/.akramcode/agent` exposes your AkramCode credentials, settings, extensions, and sessions.
- Environment variables passed into a container are available to processes inside it.
- Network access may allow code or tool output to leave the environment.
- Tool-only isolation does not constrain the host AkramCode process or extension tools that do not use the isolated backend.

Expose only the working folder, credentials, and network destinations needed for the task. Use read-only mounts or copy files into and out of the environment when you do not want writes to affect the host.

## Run AkramCode in plain Docker

Plain Docker provides the simplest whole-process container boundary.

### Build the image

Create `Dockerfile.akramcode`:

```dockerfile
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g --ignore-scripts @akramcode/coding-agent

WORKDIR /workspace
ENTRYPOINT ["akramcode"]
```

Build it from the directory containing the file:

```bash
docker build -t akramcode-sandbox -f Dockerfile.akramcode .
```

### Start AkramCode

From the working folder you want AkramCode to access, run:

```bash
docker run --rm -it \
  -e OPENROUTER_API_KEY \
  -v "$PWD:/workspace" \
  -v akramcode-agent-home:/root/.akramcode/agent \
  akramcode-sandbox
```

Replace `OPENROUTER_API_KEY` with the credential required by your provider. The named `akramcode-agent-home` volume keeps container-local settings, credentials, and sessions between runs.

Do not mount the host's `~/.akramcode/agent` unless the container should have access to your host AkramCode configuration and credentials.

### Verify the workspace

Inside AkramCode, run:

```text
!pwd
```

The command should report `/workspace`. Changes under `/workspace` write through to the mounted host folder. Remove the bind mount or use a read-only mount when that is not acceptable.


## Run AkramCode with OpenShell

[NVIDIA OpenShell](https://docs.nvidia.com/openshell/about/overview) provides local or remote sandboxes with filesystem, process, network, credential, and inference policies.

### Select a gateway

Every sandbox requires an active gateway:

```bash
openshell gateway add <gateway-url> --name <name>
openshell gateway select <name>
```

### Create the sandbox

```bash
openshell sandbox create --name akramcode-sandbox --from akramcode -- akramcode
```

AkramCode, its built-in tools, `!` commands, and extension tools run inside the OpenShell boundary.

### Transfer files to a remote sandbox

A remote gateway does not bind-mount your host working folder. Clone the repository inside the sandbox or transfer files explicitly:

```bash
openshell sandbox upload akramcode-sandbox ./working-folder /workspace
openshell sandbox download akramcode-sandbox /workspace/working-folder ./working-folder-out
```

OpenShell inference routing can keep raw model credentials outside the sandbox. When configured, point AkramCode at the corresponding OpenAI-compatible endpoint exposed by the gateway.
