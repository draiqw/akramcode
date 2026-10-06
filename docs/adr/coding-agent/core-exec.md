# Command Execution

Source: packages/coding-agent/src/core/exec.ts

## Process Termination Without Hanging

When waiting for a child process to terminate, we use a dedicated wait mechanism rather than relying on the standard process.exit event. This prevents hanging when inherited file descriptors from detached descendant processes remain open, which would otherwise keep the process alive indefinitely.
