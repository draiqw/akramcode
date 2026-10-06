# Release script behavior

Source: scripts/release.mjs

## NPM version workspace synchronization

npm version can temporarily install previous versions in node_modules before sync-versions updates inter-package version ranges. Stale lock entries must be removed and the lockfile refreshed to ensure consistent dependency resolution in the final bundle.
