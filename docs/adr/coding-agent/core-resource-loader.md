# Resource Loader

Source: packages/coding-agent/src/core/resource-loader.ts

## Context File Shadowing in Git Worktrees

When a git worktree has its own copy of a context file (like CLAUDE.md), that copy shadows the main repository's version. Loading both would apply the context twice, doubling the effect. The parent path resolution checks for this shadowing to avoid duplication.

## Repository Path Validation

A git repository with a nested worktree is only recognized when the worktree root is an ancestor of the main repository root. Sibling worktrees (added with `git worktree add ../feat`) are not considered ancestors and are excluded.

## Common Git Directory Layout Detection

In complex git layouts, the dirname of the common git directory is only trusted as the main worktree root when `.git` under that path is actually checked out from the same repository. In bare repository layouts (`proj/.bare` + `proj/main`), the dirname is just a directory holder with no checkout; in submodules, the gitdir has no commondir reference and instead lands under `.git/modules`.

## Path Canonicalization for Worktrees

When checking for shadowed context files in worktrees, paths are canonicalized to realpath because `git worktree add` writes the `.git` file's `gitdir:` target in realpath form, while the current working directory might still reference the same location via a symlink (e.g., macOS `/tmp` -> `/private/tmp`).
