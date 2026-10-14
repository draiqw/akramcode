# Migrations Module

Source: packages/coding-agent/src/migrations.ts

## Sessions Migration from v0.30.0

There was a bug in v0.30.0 where sessions were incorrectly saved to ~/.akramcode/agent/ instead of ~/.akramcode/agent/sessions/<encoded-cwd>/. This migration moves them to the correct location by parsing the cwd from the session header. See GitHub issue #320.

## Session Directory Path Encoding

The encoded session directory path follows the same encoding scheme used in session-manager.ts to ensure consistency across the codebase: forward slashes and colons are replaced with hyphens, and the path is wrapped with double-dash separators.

## Managed Binaries in tools/ Directory

The tools/ directory may contain fd/rg binaries that were auto-extracted by akramcode for internal use. We only warn if there are other custom tools present, as the auto-extracted binaries are expected and will be migrated to the bin/ directory.
