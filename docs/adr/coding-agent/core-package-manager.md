# Package Manager

Source: packages/coding-agent/src/core/package-manager.ts

## Built-in Extension Loading Defaults

Built-in extensions are enabled by default unless the user explicitly excludes them via the `extensions` setting. A matching override from the project settings (`+`, `-`, or `!` patterns) takes precedence over the global setting.

## Managed Install Peer Dependency Handling

Extension packages run inside akramcode and resolve akramcode APIs through loader aliases and virtual modules. Peer dependency resolution is disabled for managed npm installs using flags like `--legacy-peer-deps` (npm), `--omit=peer` (bun), and equivalent pnpm settings. This prevents package managers from installing or solving host-provided `@akramcode/*` peer dependencies, which would otherwise block updates if stale copies auto-install.

## Git Dependency Preservation

When cleaning untracked files from a git extension repository during update (to ensure the extension stays pristine), if the cleanup fails after dependencies are deleted, we repair the missing dependencies immediately so the existing extension can still load.

## Selective Git Fetching

When fetching before a hard reset to a specific git ref, we fetch only that specific ref rather than all branches and tags. This avoids pulling unrelated noise and keeps the repository focused on the pinned ref.

## Temporary Git Checkout Caching

When refreshing a temporary git checkout fails, the cached checkout is kept rather than deleted. This allows the extension to continue working with the cached version instead of failing completely.

## Pinned Ref Hash Inclusion

When computing the temporary directory path for a git source, the pinned ref is included in the hash computation. This ensures each pinned ref gets its own separate checkout rather than sharing a directory.
