# akramcode quality benchmark

A/B benchmark for coding quality and token cost. It runs two or more akramcode builds or settings
variants (arms) headless on the same coding tasks, grades every run with acceptance tests the agent
never sees, and reports whether quality changed and how many tokens and dollars each arm spent.

Use it to answer: "does the agent stay as good while spending fewer tokens?" for changes such as
compaction behavior, system-prompt size, deferred tools, cache layout, read-tool output format, or a
different grep backend.

Not part of the shipped CLI. Code lives in `packages/evals/src/bench/`, tasks in
`packages/evals/bench/tasks/`, settings presets in `packages/evals/bench/settings/`.

## Quick start

From `packages/evals`:

```bash
# list task instances
node src/bench/cli.ts list

# check every task is gradable: hidden tests fail on the fixture and pass with the reference solution
node src/bench/cli.ts verify-tasks

# release v1.0.9 vs the current source checkout, 3 reps, 2 runs in parallel
node src/bench/cli.ts run \
  --arm base=release:v1.0.9 \
  --arm cand=source:../.. \
  --reps 3 --concurrency 2

# same build, settings variant: does forcing early compaction hurt quality?
node src/bench/cli.ts run \
  --arm default=source:../.. \
  --arm early=source:../.. --settings early=early-compaction \
  --tasks long
```

`npm run bench -w packages/evals -- <command> ...` is equivalent from the repository root (pass
paths relative to `packages/evals`).

Prerequisites:

- Node 22.19+ (type stripping), `python3` 3.11+, `git`, and `gh` for `release:` builds.
- An OAuth `auth.json` for the provider, by default `/tmp/akc-def/auth.json` (`--auth` to change).
  It is copied into each isolated agent dir. When a run refreshes the token, the newer token is
  written back so later runs do not start from a rotated-out refresh token.
- For `source:` builds: installed `node_modules` and hydrated model data
  (`packages/providers/src/providers/data/`) in that checkout.

## Arms

`--arm <name>=<build>` is repeatable. The first arm is the baseline; each other arm is compared to it.

| build | meaning |
| --- | --- |
| `release:<tag>` | GitHub release tarball (`gh release download`), cached in `.bench/cache/releases/` |
| `binary:<path>` | any akramcode executable |
| `source:<dir>` | source checkout, run as `node --import <source-resolver> packages/coding-agent/src/cli.ts` |
| `ref:<git ref>` | detached worktree of this repository at the ref (cached in `.bench/cache/refs/`), run as source; `node_modules` and model data are cloned from the current checkout, so refs with different dependencies need a manual install |

`--settings <arm>=<value>` gives an arm a settings overlay: a JSON file, a preset name from
`bench/settings/`, or inline JSON. Presets:

| preset | settings |
| --- | --- |
| `early-compaction` | `{"$compactAtTokens": 20000, "compaction": {"keepRecentTokens": 6000}}`: threshold compaction once the context exceeds 20k tokens |
| `online-compaction` | `{"defaultTools": ["+update_plan"]}`: online compaction at plan steps |
| `no-tool-result-clearing` | `compaction.clearToolResults.enabled = false` |
| `no-restore-context` | `compaction.restoreContext = false` |

`$compactAtTokens: N` is a harness macro: it becomes `compaction.reserveTokens = contextWindow - N`.
The context window comes from `--context-window` (default 922000, the window of the openai-codex
gpt-6 models). Settings unknown to an older build are ignored by that build, so a settings arm only
makes sense on builds that implement the setting.

## Tasks

20 task instances: 16 base tasks plus a `@compact` variant of each long task.

| category | tasks |
| --- | --- |
| bugfix | `py-bugfix-intervals`, `ts-bugfix-lru-cache`, `py-bugfix-csv-quoting`, `ts-bugfix-business-days`, `py-bugfix-cross-module` |
| feature | `ts-feature-cli-flags`, `py-feature-retry`, `ts-feature-event-emitter`, `py-feature-template-filters` |
| refactor (multi-file) | `ts-refactor-rename-api`, `py-refactor-extract-validators`, `ts-refactor-options-object` |
| comprehension (read a codebase, then answer or fix) | `py-comprehension-config-trace`, `ts-comprehension-plugin-order` |
| long (lots of tool output; information found early is needed at the end) | `long-py-log-triage`, `long-ts-multi-bug`, `long-py-api-migration`, `long-ts-auth-audit` |

Each long task has a `compact` variant (`$compactAtTokens: 12000`, `keepRecentTokens: 4000`), so
threshold compaction fires several times during the run on every arm (peak context of these tasks is
25-30k tokens without compaction). Compare `long` against `long@compact` in
the "By category" table to see what compaction costs in quality.

Task layout, `bench/tasks/<id>/`:

```
task.json        id, title, category, language, prompt, test (argv), timeoutSec, variants
repo/            fixture copied into a fresh workspace (git init + commit)
setup/setup.py   optional, generates bulky content in the workspace before the agent starts
hidden/          acceptance tests, copied to <workspace>/__hidden__/ only after the agent exits
solution/        reference solution: files/ overlay and/or apply.py (used only by verify-tasks)
```

Rules for new tasks: Python stdlib or plain Node (type stripping, `.ts` import extensions), no
dependency installs; the prompt fully specifies what the hidden tests check; hidden tests are
deterministic; `verify-tasks` must report `ok`. The prompt must not mention the hidden tests.

## What one run does

1. Creates a temp dir with `ws/` (fixture + setup output, committed to git), `agent/` (`auth.json`,
   `settings.json` for the arm and variant), and `home/` (empty `HOME`, so no user skills, context
   files, or settings leak in).
2. Runs `<build> -p "<prompt>" --mode json --provider <p> --model <m>` in `ws/` with stdin from
   `/dev/null`, `AKRAMCODE_CODING_AGENT_DIR=agent/`, `HOME=home/`, and the task timeout.
3. Parses the JSON event stream: tokens (input, cache read, cache write, output) and cost from every
   assistant `message_end` plus compaction summary usage, turns, tool calls and tool errors, peak
   context, compactions (threshold/overflow `compaction_end` and online compaction entries),
   `tool_results_cleared` events, retries, request errors.
4. Copies `hidden/` to `ws/__hidden__/` (replacing anything the agent created there) and runs the
   task's test command. Exit code 0 is a pass.

Artifacts per run in `<out>/runs/<runId>/`: `events.jsonl`, `stderr.txt`, `settings.json`,
`test-output.txt[.stderr]`, `result.json`. `--keep-workspaces` keeps the temp workspace.

Runs are interleaved: repetitions are the outer loop, task order is shuffled per repetition with a
fixed seed, and the arm order alternates, so provider latency drift and rate limits hit all arms
alike. `--concurrency` bounds parallel runs (default 2). Ctrl-C kills running agents; rerun with
`--resume --out <dir>` to continue.

## Report

`<out>/report.md` and `<out>/summary.json` (rebuild with `node src/bench/cli.ts report <out>`):

- Verdict line per candidate, e.g. `cand vs base: quality not significantly different (pass 85% vs 87%,
  delta -1.7 pp, 95% CI [-8.3 pp, +5.0 pp], McNemar p=0.774; non-inferior at -10 pp margin); total
  tokens -31% (95% CI [-38%, -24%]); cost -27% (...); wall time -12%`.
- Pass rate per arm with a 95% Wilson interval.
- Token totals by kind, cost, medians per run (tokens, cost, wall time, turns, tool calls, peak context).
- Paired comparison: runs are paired by (task instance, repetition). Quality uses the exact McNemar
  test on discordant pairs. The pass-rate delta CI is the envelope of the Newcombe paired score
  interval (honest at small n) and a bootstrap that resamples whole task instances (repetitions of
  one task are correlated); token and cost change CIs use the bootstrap. Below 10 paired instances
  the report warns that intervals are unreliable.
- Compaction stats, pass rate by category, per-task table, and error list.

Runs with a harness error (fixture setup or spawn failure) are excluded from quality numbers and
listed separately. Agent timeouts and crashes count as failures.

## Cost and time

Measured in the smoke run (gpt-6-luna, 2026-10-07, 10 runs):

| run type | wall time | total tokens | cost |
| --- | --- | --- | --- |
| small task (bugfix, feature) | 22-50 s | 18-24k | $0.0015-0.002 |
| long task, default settings | ~33 s | 106-123k | ~$0.0045 |
| long task, `@compact` variant | 30-153 s | 43-288k (4-8 compactions) | $0.002-0.025 |

Projected full run with defaults (20 instances x 2 arms x 3 reps = 120 runs, concurrency 2):
about 1-2 hours and $0.5-1.5 on gpt-6-luna. gpt-6.1-sol costs 20x more per token (about $10-30
for the same run) and is slower per request. Most tokens are cache reads; the cost column already
prices them at the cache-read rate.

## Statistical power

With 20 instances x 3 reps, a 95% CI on a pass-rate delta is roughly +-10 pp when most tasks are
stable. That is enough to catch a broken change, not a 2-3 pp regression. To tighten it, raise
`--reps`, add tasks, or use a model that is not at ceiling or floor on the task set; tasks every
arm always passes (or always fails) contribute no discordant pairs. Token and cost changes are much
less noisy than pass rates and usually reach a tight CI with the default settings.

## Limitations

- Task fixtures are small; behavior on large real repositories may differ.
- Single provider per run; the model is shared by all arms.
- Hidden tests check behavior specified in the prompt, not code quality or style.
- `ref:` builds reuse the current checkout's `node_modules`.
- Wall time includes provider latency, which varies with load; compare it only across interleaved arms.
