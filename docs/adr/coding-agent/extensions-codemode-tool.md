# Codemode Tool Design

Source: packages/coding-agent/src/extensions/codemode/tool.ts

## Scripts cannot start other scripts

Scripts cannot nest themselves (are not callable from within scripts). This is enforced by setting the codemode tool's exposure to "model-only", preventing recursive script execution that could cause unbounded nesting and resource exhaustion.

## Raw text output for capable models

Models capable of constrained sampling receive the script as raw text rather than JSON-escaped string. This enables grammar-guided generation for more reliable script parsing and execution.

## Lazy load sandbox resources

The sandbox (QuickJS worker and WebAssembly module) loads on the first codemode call, not at startup. This defers expensive initialization and reduces startup time for sessions that never use codemode.
