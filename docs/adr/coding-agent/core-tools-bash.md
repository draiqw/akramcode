# Bash Tool

Source: packages/coding-agent/src/core/tools/bash.ts

## Signal Exit Code Convention
When a shell is killed by a signal, it has no exit code. The code uses the standard shell convention of reporting 128 + signal number so callers don't mistake signal termination for a successful command.
