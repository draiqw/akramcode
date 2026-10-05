# Hermes Upstream Sync Design

## Goal

Maintain `draiqw/akram-code` as a customized Hermes Agent codebase while keeping changes from `NousResearch/hermes-agent` reviewable through pull requests.

## Design

The repository uses `origin` for `draiqw/akram-code` and an `upstream` remote for `NousResearch/hermes-agent`. The initial repository contents are imported from upstream's `main` branch.

On a schedule and on manual dispatch, GitHub Actions fetches `upstream/main`, creates a branch from the current local `main`, merges upstream changes, and opens a pull request back to `main`. The workflow uses a unique branch containing the upstream commit SHA, so every upstream update remains independently reviewable.

The workflow has write permission for contents and pull requests. It does not merge PRs automatically. If the merge has conflicts, the workflow fails without pushing a partial branch; the conflicts must be resolved by a maintainer. Pull request creation is skipped when `main` already contains the upstream commit.

## Success Criteria

- `akram-code` contains the current upstream Hermes source.
- `upstream` is configured as the canonical source remote.
- A scheduled/manual workflow can detect upstream changes.
- A clean upstream update produces a PR into `main`.
- A conflicting update stops safely without silently changing `main`.
