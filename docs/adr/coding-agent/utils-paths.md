# Path Utilities

Source: packages/coding-agent/src/utils/paths.ts

## File URL Path Classification

File URLs are intentionally classified as local paths and are resolved by resolvePath(). Only package sources (npm:, git:, etc.), built-in extensions, and remote URL protocols are considered non-local.
