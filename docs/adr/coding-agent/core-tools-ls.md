# Ls Tool

Source: packages/coding-agent/src/core/tools/ls.ts

## No line limit in output truncation

Apply byte truncation without a separate line limit because the entry count is already capped by the limit parameter. Adding a line limit would be redundant.
