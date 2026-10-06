# Skills Loader

Source: packages/coding-agent/src/core/skills.ts

## Skip node_modules During Discovery
Node_modules directories are skipped during recursive skill discovery to avoid scanning dependencies, which would be wasteful.
