# Output Accumulator

Source: packages/coding-agent/src/core/tools/output-accumulator.ts

## Character boundary alignment in UTF-8 truncation

When truncating at character boundaries in UTF-8, we must account for incomplete trailing sequences in the head part (held back by streaming decode) and skip leading continuation bytes in the tail part. This ensures valid UTF-8 without broken multibyte characters at the omission boundary.
