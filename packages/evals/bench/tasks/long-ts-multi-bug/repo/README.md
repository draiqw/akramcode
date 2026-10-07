# stage-kit

Forty small integer-array transformation stages live in `src/stages/stageNN.ts`. Each module's doc
comment is its specification. `src/stages/index.ts` registers all stages.

The test suite (`test/stages.test.ts`) runs every stage against the cases in `test/cases.json` and
prints one line per case.

Run tests: `node --test test/*.test.ts` (Node 22.19+, no dependencies).
