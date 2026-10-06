# Live Conversation State

Source: packages/durable/src/harness/live.ts

## Checkpoint Granularity for Delta Chains

A complete base is created whenever nothing runs: no generation and no running tool slot. This holds during idle, when handing a generation over to its tool round, and between tools, so the delta chain spans at most one generation or the overlapping execution of one round's tools. A slot holds output only while running, so every base is small. Tool output benchmarks verify this rule, and delta-count bounds are not needed.
