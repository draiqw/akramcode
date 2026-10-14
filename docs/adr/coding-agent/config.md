# Package Configuration and Detection

Source: packages/coding-agent/src/config.ts

## Windows Global npm Prefix Ambiguity

Windows global npm installations use the structure `<prefix>\node_modules`, which is indistinguishable from local project installs by path shape alone. Custom Windows npm prefixes cannot be reliably inferred without running `npm root -g` for verification, so inference is skipped.

## Bun Metadata Organization

The `build:binary` process places Bun's metadata inside the `dist/` directory. Node.js requires the package root instead of the `dist/` directory so asset paths remain relative to the source root and do not double up as `dist/dist/`.
