# Stdio Transport

Source: packages/mcp/src/transports/stdio.ts

## Windows process termination via taskkill

Windows has no graceful signals like POSIX systems. Additionally, cross-spawn runs .cmd shims through cmd.exe. Killing only cmd.exe would leave the underlying server process running. We use taskkill with the /T flag to terminate the entire process tree.

## Process group termination for wrappers

Using a negative PID terminates the entire process group, not just the direct child. This ensures that wrapper processes like npx or uvx—which launch the actual server—do not leave the server running when the parent exits.

## Detached process groups for child cleanup

Setting detached: true creates the process in its own group. This allows the transport to terminate the server and all its children when closing, preventing orphaned processes.
