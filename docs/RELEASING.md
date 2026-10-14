# Releasing

A pushed tag `vX.Y.Z` runs `.github/workflows/release.yml`: it checks that the tag matches `packages/coding-agent/package.json`, builds the four standalone archives with `scripts/build-binaries.sh`, and publishes the GitHub release with `scripts/install.sh` (published as `install.sh`), `SHA256SUMS`, and the `## [X.Y.Z]` section of `packages/coding-agent/CHANGELOG.md` as notes.

## Steps

1. `npm run check` passes on `main`.
2. `npm run version:patch` (or `version:minor`, `version:major`).
3. `node scripts/generate-coding-agent-shrinkwrap.mjs` and `node scripts/generate-coding-agent-install-lock.mjs`.
4. Revert the version bump in `packages/coding-agent/examples/extensions/*/package.json` and their lockfiles.
5. In every `packages/*/CHANGELOG.md` with `## [Unreleased]`, rename it to `## [X.Y.Z] - YYYY-MM-DD`.
6. Stage the changed files by path and commit `chore: release X.Y.Z` with `AKRAMCODE_ALLOW_LOCKFILE_CHANGE=1`.
7. `git tag vX.Y.Z`, then `git push origin main vX.Y.Z`.
8. Add an empty `## [Unreleased]` section to the same changelogs, commit `docs: add [Unreleased] section for next cycle`, push.

## Verify

- `gh run watch -R draiqw/akramcode $(gh run list -R draiqw/akramcode -w release -L 1 --json databaseId -q '.[0].databaseId')`
- `gh release view vX.Y.Z -R draiqw/akramcode` lists four `akramcode-*.tar.gz`, `SHA256SUMS`, and `install.sh`.
- `akramcode update --self && akramcode --version`

## Recovery

If the workflow fails, fix the cause on `main` and delete the release if it was created (`gh release delete vX.Y.Z`). A fix in the workflow: `gh workflow run release -R draiqw/akramcode -f tag=vX.Y.Z` builds the same tag with the workflow from `main`. A fix in the code: release the next patch version instead of moving the tag.
