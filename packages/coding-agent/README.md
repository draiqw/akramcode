> New issues and PRs from new contributors are closed automatically. Maintainers review closed submissions daily. See [CONTRIBUTING.md](https://github.com/draiqw/akramcode/blob/main/CONTRIBUTING.md).

# AkramCode

AkramCode is a minimal, extensible AI agent for the terminal. Adapt AkramCode to your workflow, not the other way around.

Ask AkramCode to create the prompt templates, skills, extensions, and themes you need, or install a AkramCode package. Use AkramCode directly, automate it in print, JSON, or RPC mode, or build applications with the TypeScript SDK.

## Getting started

Install the command-line interface with npm:

```bash
npm install -g --ignore-scripts @akramcode/coding-agent
```

This requires Node.js 22.19 or newer. AkramCode does not require dependency lifecycle scripts for a normal npm installation.

On macOS or Linux, you can instead use the installer:

```bash
gh release download --repo draiqw/akramcode -p 'akramcode-*.tar.gz'
tar xzf akramcode-*.tar.gz && ./akramcode/akramcode --version
```

Start AkramCode in the directory where you want it to work:

```bash
cd /path/to/project
akramcode
```

For a built-in AI provider, run `/login` inside AkramCode to connect a subscription or API key. Then give AkramCode a task.

See the [documentation](docs/index.md) for full setup and usage instructions.

## Development

Clone the repository, install its dependencies, and run AkramCode from source:

```bash
git clone https://github.com/draiqw/akramcode
cd akramcode
npm install --ignore-scripts
./akramcode
```

`akramcode` can be called from any directory and preserves the caller's working directory.

Before submitting changes, run:

```bash
npm run check
./scripts/test.sh
```

Read [CONTRIBUTING.md](https://github.com/draiqw/akramcode/blob/main/CONTRIBUTING.md) before opening an issue or pull request. It defines the contribution gate, issue quality bar, and required checks. Read [AGENTS.md](https://github.com/draiqw/akramcode/blob/main/AGENTS.md) for repository-specific implementation, testing, dependency, and release rules.

## License

MIT
