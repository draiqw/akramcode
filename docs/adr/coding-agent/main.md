# Main CLI Entry Point

Source: packages/coding-agent/src/main.ts

## TTY Detection for Piped Stdin

When stdin is connected to a terminal (TTY), we avoid reading piped stdin since the process is running interactively. Only non-TTY scenarios (like piped input from another process) should read stdin.

## Session Resolution by Exact ID

Session lookup by exact ID only requires reading session headers, which is more efficient than loading full metadata. Prefix matching requires the full metadata listing, so we try exact ID first and fall back to the expensive full search only when needed.

## Windows Process Exit During Fetch Teardown

On Windows, Node can encounter assertion failures when process.exit(0) runs during fetch() teardown. For package commands, we normally exit immediately to prevent bad extensions from keeping one-shot commands alive, but for successful `akramcode update`, we allow natural drainage instead.

## Project CWD Resolution Before Runtime Services

The final runtime working directory must be resolved before creating cwd-bound runtime services. Session selection (--session, --resume) can pick sessions from other projects, so project-local settings, resources, provider registrations, and models must only be resolved after the target session directory is known.

## User-Authored Theme Validation

The CLI reads user-authored themes, so it opts into full validation before any theme loads to catch configuration errors early.

## RPC Catalog Refresh Timing

RPC mode refreshes catalogs in the background immediately, while interactive mode defers catalog refresh until after TUI initialization to avoid blocking the UI startup.
