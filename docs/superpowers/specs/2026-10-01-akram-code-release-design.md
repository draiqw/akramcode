# akram-code Release and Update Design

## Goal

Make `draiqw/akram-code` installable and self-updating from GitHub, while preserving the current TUI, ACP, browser tools, and existing runtime architecture.

## Decisions

- GitHub is the only hosting required: the repository is the update source and GitHub Releases are the published version record.
- Releases are created from tags matching `v*` (for example `v0.1.0`).
- The installed checkout updates from `origin/main`; a release tag records the version and CI validates the same tree.
- The executable remains `akramcode` for compatibility with the existing CLI/TUI and ACP integrations.
- User-facing product/repository defaults use `akram-code` and `draiqw/akram-code`.
- The upstream `NousResearch/akramcode-agent` remote is not used by installation or update paths.
- No Desktop, gateway, or ACP removal is part of this change; ACP remains supported.

## Release flow

1. Push a version tag such as `v0.1.0`.
2. GitHub Actions checks out that tag, runs the project test runner, validates the installer, and creates a GitHub Release.
3. A fresh install clones `draiqw/akram-code`.
4. An existing install fetches `origin/main` and runs the existing update completion path.

## Verification

- Static checks prove no installer default points at the upstream repository.
- Workflow syntax and shell tests pass.
- A temporary install uses `AKRAMCODE_REPO_URL` to clone the local repository mirror, starts the CLI/TUI entrypoint in check mode, and confirms the checkout remote is `akram-code`.
- Existing update tests run through `scripts/run_tests.sh`, never bare pytest.
