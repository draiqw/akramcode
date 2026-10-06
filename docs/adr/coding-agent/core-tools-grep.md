# Grep Tool

Source: packages/coding-agent/src/core/tools/grep.ts

## Deferred match formatting for async operations

Format matches after streaming finishes rather than during the stream. This allows custom readFile() backends to be async, which would block the streaming event loop if done during the stream.

## No line limit in output truncation

Apply byte truncation without a separate line limit because the match limit already capped the number of result rows. Adding a line limit would be redundant and confusing.
