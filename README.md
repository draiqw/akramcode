# AkramCode Agent Harness

This is the home of the AkramCode agent harness project including our self extensible coding agent.

* **[@akramcode/coding-agent](packages/coding-agent)**: Interactive coding agent CLI
* **[@akramcode/agent-core](packages/agent)**: Agent runtime with tool calling and state management
* **[@akramcode/ai](packages/ai)**: Unified multi-provider LLM API (OpenAI, OpenAI Codex, OpenRouter, DeepSeek)

Documentation: [packages/coding-agent/docs](packages/coding-agent/docs). You can also ask the agent to explain itself.

## Install

macOS and Linux (arm64, x64):

```bash
curl -fsSL https://github.com/draiqw/akramcode/releases/latest/download/install.sh | sh
```

The script downloads the standalone binary for your platform from [GitHub Releases](https://github.com/draiqw/akramcode/releases), verifies it against `SHA256SUMS`, unpacks it to `~/.akramcode/bin-release`, and puts an `akramcode` launcher in `~/.local/bin`. Set `AKRAMCODE_VERSION=v1.0.20` to pin a release, or `AKRAMCODE_INSTALL_DIR` / `AKRAMCODE_BIN_DIR` to change the locations. Run the same command again to update.

## All Packages

| Package | Description |
|---------|-------------|
| **[@akramcode/chord](packages/chord)** | Standalone application-composition runtime for services, replicated state, RPC, and plugins |
| **[@akramcode/telemetry](packages/telemetry)** | Vendor-neutral telemetry contracts, reference adapter, conformance tests, and typed schemas |
| **[@akramcode/ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, OpenAI Codex, OpenRouter, DeepSeek) |
| **[@akramcode/durable](packages/durable)** | Durable conversation, task, and document runtime |
| **[@akramcode/agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@akramcode/coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@akramcode/tui](packages/tui)** | Terminal UI library with differential rendering |

## Permissions & Containerization

AkramCode does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

If you need stronger boundaries, containerize or sandbox AkramCode. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for three patterns:

- **Plain Docker**: run the whole `akramcode` process in a local container for simple isolation.
- **OpenShell**: run the whole `akramcode` process in a policy-controlled sandbox.

## Contributing

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build         # Refresh model data, then build all packages
npm run build:offline # Rebuild using existing model data without network access
npm run check         # Lint, format, and type check
./scripts/test.sh            # Run tests (skips LLM-dependent tests without API keys)
./akramcode           # Run akramcode from sources (can be run from any directory)
```

## Building standalone binaries from release source

GitHub releases include a versioned source archive covered by the release's `SHA256SUMS` file. Extract it and run the same build script used for the official standalone binaries:

```bash
VERSION="<release-version>"
tar -xzf "akramcode-${VERSION}-source.tar.gz"
cd "akramcode-${VERSION}"
./scripts/build-binaries.sh --offline-model-data --platform linux-x64 --out "$PWD/out"
```

The archive includes release model data and native prebuilds. `--offline-model-data` uses that model data without refreshing provider catalogs. The script installs dependencies and builds the executable with its runtime assets; pass `--skip-install` if dependencies are already provided.

## Supply-chain hardening

We treat npm dependency changes as reviewed code changes.

- Direct external dependencies are pinned to exact versions. Internal workspace packages remain version-ranged.
- `.npmrc` sets `save-exact=true` and `min-release-age=2` to avoid same-day dependency releases during npm resolution.
- `package-lock.json` is the dependency ground truth. Pre-commit blocks accidental lockfile commits unless `AKRAMCODE_ALLOW_LOCKFILE_CHANGE=1` is set.
- `npm run check` verifies pinned direct deps, native TypeScript import compatibility, and the generated coding-agent shrinkwrap.
- The published CLI package includes `packages/coding-agent/npm-shrinkwrap.json`, generated from the root lockfile, to pin transitive deps for npm users.
- Release smoke tests use `npm run release:local` to build, pack, and create isolated npm and Bun installs outside the repo before tagging a release.
- Local release installs, documented npm installs, and `akramcode update --self` use `--ignore-scripts` where supported.
- CI installs with `npm ci --ignore-scripts`, and a scheduled GitHub workflow runs `npm audit --omit=dev` plus `npm audit signatures --omit=dev`.
- Shrinkwrap generation has an explicit allowlist for dependency lifecycle scripts; new lifecycle-script deps fail checks until reviewed.

## License

Proprietary. See `LICENSE`; third-party licenses are in `THIRD_PARTY_NOTICES.md`.
