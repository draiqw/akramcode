# Build coding agent bundle configuration

Source: scripts/build-coding-agent-bundle.mjs

## Lazy Jiti transform plugin

Bun embeds Babel transforms when using jiti/static directly. The lazy-jiti plugin replaces this with synchronous require() so Jiti loads only when importing an extension, keeping Babel deferred until cache misses actually need transformation.

## Disable monorepo path aliases in bundle

Path aliases from tsconfig are source-oriented and conflict with the bundled output. Release builds must resolve the same package entries as installed npm packages, so we clear the tsconfig during bundling.
