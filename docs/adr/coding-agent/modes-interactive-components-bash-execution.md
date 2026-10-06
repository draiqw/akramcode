# Bash Execution Component

Source: packages/coding-agent/src/modes/interactive/components/bash-execution.ts

## Preview Line Limit

The preview line limit when not expanded is set to 20 lines to match the behavior of the tool execution system, ensuring consistency across different output display modes.

## Border Color for Excluded Commands

Commands prefixed with `!!` are marked as excluded from context. These use a dim border color instead of the normal bash mode color to visually distinguish them from regular commands.

## Binary Data Safety

Binary data in command output is already sanitized in tui-renderer.ts executeBashCommand, so ANSI stripping and line ending normalization here is safe to perform.
