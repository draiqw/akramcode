"""Generate a 40-stage TypeScript project with 6 injected bugs (cwd = workspace).

`python3 setup.py --expected` prints the hidden expectations instead.
"""

import hashlib
import json
import os
import random
import sys

N_STAGES = 40
BUGGY = {7: "clamp", 13: "windowSum", 19: "dedupeFirst", 26: "rotateLeft", 31: "modulo", 38: "sortDesc"}


def op_defs():
    return {
        "scale": {
            "params": lambda r: {"K": r.randint(2, 7)},
            "doc": "Multiply every element by {K}.",
            "body": "return xs.map((x) => x * {K});",
            "ref": lambda xs, p: [x * p["K"] for x in xs],
        },
        "offset": {
            "params": lambda r: {"C": r.randint(-50, 50)},
            "doc": "Add {C} to every element.",
            "body": "return xs.map((x) => x + ({C}));",
            "ref": lambda xs, p: [x + p["C"] for x in xs],
        },
        "clamp": {
            "params": lambda r: {"LO": r.randint(-30, 0), "HI": r.randint(10, 40)},
            "doc": "Clamp every element into the inclusive range [{LO}, {HI}].",
            "body": "return xs.map((x) => Math.min({HI}, Math.max({LO}, x)));",
            "bug": "return xs.map((x) => Math.min({HI} - 1, Math.max({LO}, x)));",
            "ref": lambda xs, p: [min(p["HI"], max(p["LO"], x)) for x in xs],
        },
        "runningSum": {
            "params": lambda r: {},
            "doc": "Inclusive prefix sums: out[i] = xs[0] + ... + xs[i].",
            "body": "const out: number[] = [];\n\tlet acc = 0;\n\tfor (const x of xs) {\n\t\tacc += x;\n\t\tout.push(acc);\n\t}\n\treturn out;",
            "ref": lambda xs, p: [sum(xs[: i + 1]) for i in range(len(xs))],
        },
        "dedupeFirst": {
            "params": lambda r: {},
            "doc": "Remove duplicates, keeping the first occurrence of each value and the original order of first occurrences.",
            "body": "const seen = new Set<number>();\n\tconst out: number[] = [];\n\tfor (const x of xs) {\n\t\tif (!seen.has(x)) {\n\t\t\tseen.add(x);\n\t\t\tout.push(x);\n\t\t}\n\t}\n\treturn out;",
            "bug": "return xs.filter((x, i) => xs.lastIndexOf(x) === i);",
            "ref": lambda xs, p: list(dict.fromkeys(xs)),
        },
        "sortDesc": {
            "params": lambda r: {},
            "doc": "Return a new array sorted numerically in descending order.",
            "body": "return [...xs].sort((a, b) => b - a);",
            "bug": "return [...xs].sort().reverse();",
            "ref": lambda xs, p: sorted(xs, reverse=True),
        },
        "windowSum": {
            "params": lambda r: {"W": r.randint(2, 4)},
            "doc": "Sums of every contiguous window of size {W}: out has length max(0, n - {W} + 1).",
            "body": "const out: number[] = [];\n\tfor (let i = 0; i + {W} <= xs.length; i++) {\n\t\tlet s = 0;\n\t\tfor (let j = i; j < i + {W}; j++) s += xs[j];\n\t\tout.push(s);\n\t}\n\treturn out;",
            "bug": "const out: number[] = [];\n\tfor (let i = 0; i + {W} < xs.length; i++) {\n\t\tlet s = 0;\n\t\tfor (let j = i; j < i + {W}; j++) s += xs[j];\n\t\tout.push(s);\n\t}\n\treturn out;",
            "ref": lambda xs, p: [sum(xs[i : i + p["W"]]) for i in range(0, len(xs) - p["W"] + 1)],
        },
        "takeEvery": {
            "params": lambda r: {"K": r.randint(2, 4)},
            "doc": "Keep the elements at indices 0, {K}, 2*{K}, ...",
            "body": "return xs.filter((_, i) => i % {K} === 0);",
            "ref": lambda xs, p: xs[:: p["K"]],
        },
        "reverseChunks": {
            "params": lambda r: {"K": r.randint(2, 4)},
            "doc": "Split into consecutive chunks of size {K} (the last chunk may be shorter) and reverse each chunk in place.",
            "body": "const out: number[] = [];\n\tfor (let i = 0; i < xs.length; i += {K}) {\n\t\tout.push(...xs.slice(i, i + {K}).reverse());\n\t}\n\treturn out;",
            "ref": lambda xs, p: [y for i in range(0, len(xs), p["K"]) for y in reversed(xs[i : i + p["K"]])],
        },
        "diff": {
            "params": lambda r: {},
            "doc": "Consecutive differences: out[i] = xs[i + 1] - xs[i] (length max(0, n - 1)).",
            "body": "return xs.slice(1).map((x, i) => x - xs[i]);",
            "ref": lambda xs, p: [xs[i + 1] - xs[i] for i in range(len(xs) - 1)],
        },
        "modulo": {
            "params": lambda r: {"M": r.randint(3, 9)},
            "doc": "Mathematical modulo {M}: every result is in [0, {M} - 1], also for negative inputs.",
            "body": "return xs.map((x) => ((x % {M}) + {M}) % {M});",
            "bug": "return xs.map((x) => Math.abs(x % {M}));",
            "ref": lambda xs, p: [x % p["M"] for x in xs],
        },
        "rotateLeft": {
            "params": lambda r: {"K": r.randint(1, 5)},
            "doc": "Rotate left by {K} positions (modulo the length): rotateLeft([1,2,3,4], 1) = [2,3,4,1]. Empty input gives [].",
            "body": "if (xs.length === 0) return [];\n\tconst s = {K} % xs.length;\n\treturn [...xs.slice(s), ...xs.slice(0, s)];",
            "bug": "if (xs.length === 0) return [];\n\tconst s = (xs.length - ({K} % xs.length)) % xs.length;\n\treturn [...xs.slice(s), ...xs.slice(0, s)];",
            "ref": lambda xs, p: (xs[p["K"] % len(xs) :] + xs[: p["K"] % len(xs)]) if xs else [],
        },
        "filterGreater": {
            "params": lambda r: {"T": r.randint(-10, 10)},
            "doc": "Keep only the elements strictly greater than {T}, in order.",
            "body": "return xs.filter((x) => x > ({T}));",
            "ref": lambda xs, p: [x for x in xs if x > p["T"]],
        },
    }


def fmt(template, params):
    out = template
    for k, v in params.items():
        out = out.replace("{" + k + "}", str(v))
    return out


def plan():
    rng = random.Random(4242)
    ops = op_defs()
    names = sorted(ops)
    stages = []
    for i in range(1, N_STAGES + 1):
        op = BUGGY.get(i) or rng.choice(names)
        params = ops[op]["params"](rng)
        stages.append({"n": i, "op": op, "params": params})
    return stages


def module_source(stage, ops, buggy):
    n, op, params = stage["n"], stage["op"], stage["params"]
    d = ops[op]
    body = fmt(d["bug"] if buggy else d["body"], params)
    sid = f"stage{n:02d}"
    pdesc = ", ".join(f"{k.lower()}={v}" for k, v in params.items())
    return f"""/**
 * {sid}: {op}{f"({pdesc})" if pdesc else ""}
 *
 * Spec: {fmt(d["doc"], params)}
 * Inputs are arrays of integers. The input array must not be mutated; always return a new array.
 */

export const STAGE_ID = "{sid}";

function assertIntegers(xs: readonly number[]): void {{
\tfor (const x of xs) {{
\t\tif (!Number.isInteger(x)) throw new TypeError(`{sid} expects integers, got ${{x}}`);
\t}}
}}

/** Human readable description used in pipeline traces. */
export function describe(): string {{
\treturn "{op}{f"({pdesc})" if pdesc else ""}";
}}

export function run(xs: readonly number[]): number[] {{
\tassertIntegers(xs);
\t{body}
}}
"""


def make_cases(rng, stage, ops, count):
    cases = []
    lengths = [0, 1, 2, 3, 5, 7, 8, 10, 12]
    for c in range(count):
        n = lengths[c] if c < len(lengths) else rng.randint(4, 14)
        xs = [rng.randint(-60, 60) for _ in range(n)]
        if c % 3 == 2 and n > 2:
            xs[-1] = xs[0]  # duplicates
        if c % 4 == 3:
            xs = [x * 7 for x in xs]
        cases.append([xs, ops[stage["op"]]["ref"](list(xs), stage["params"])])
    return cases


INDEX_TEMPLATE = """{imports}

export interface Stage {{
\tSTAGE_ID: string;
\tdescribe(): string;
\trun(xs: readonly number[]): number[];
}}

export const STAGES: Stage[] = [{names}];

/** Run every stage independently on the same input and return a trace. */
export function traceAll(xs: readonly number[]): string[] {{
\treturn STAGES.map((s) => `${{s.STAGE_ID}} ${{s.describe()}} -> ${{JSON.stringify(s.run(xs))}}`);
}}
"""

TEST_SOURCE = """import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { STAGES } from "../src/stages/index.ts";

const cases: Record<string, [number[], number[]][]> = JSON.parse(
\treadFileSync(new URL("./cases.json", import.meta.url), "utf8"),
);

for (const stage of STAGES) {
\ttest(`${stage.STAGE_ID} ${stage.describe()}`, () => {
\t\tconst list = cases[stage.STAGE_ID];
\t\tassert.ok(list && list.length > 0, `no cases for ${stage.STAGE_ID}`);
\t\tlet failures = 0;
\t\tfor (const [i, [input, expected]] of list.entries()) {
\t\t\tconst frozen = Object.freeze([...input]);
\t\t\tconst got = stage.run(frozen);
\t\t\tconst ok = JSON.stringify(got) === JSON.stringify(expected);
\t\t\tif (!ok) failures++;
\t\t\tconsole.log(
\t\t\t\t`[${stage.STAGE_ID}] case ${String(i).padStart(2, "0")} ${ok ? "PASS" : "FAIL"} input=${JSON.stringify(input)} expected=${JSON.stringify(expected)} got=${JSON.stringify(got)}`,
\t\t\t);
\t\t}
\t\tassert.equal(failures, 0, `${stage.STAGE_ID}: ${failures} of ${list.length} cases failed`);
\t});
}
"""


def build():
    ops = op_defs()
    stages = plan()
    files = {}
    for s in stages:
        files[f"src/stages/stage{s['n']:02d}.ts"] = module_source(s, ops, s["n"] in BUGGY)
    imports = "\n".join(f'import * as stage{s["n"]:02d} from "./stage{s["n"]:02d}.ts";' for s in stages)
    names = ", ".join(f"stage{s['n']:02d}" for s in stages)
    files["src/stages/index.ts"] = INDEX_TEMPLATE.format(imports=imports, names=names)
    rng = random.Random(777)
    visible = {f"stage{s['n']:02d}": make_cases(rng, s, ops, 12) for s in stages}
    files["test/cases.json"] = json.dumps(visible, indent=1) + "\n"
    files["test/stages.test.ts"] = TEST_SOURCE
    rng2 = random.Random(31337)
    extra = {f"stage{s['n']:02d}": make_cases(rng2, s, ops, 20) for s in stages}
    expected = {
        "hashes": {
            p: hashlib.sha256(files[p].encode("utf-8")).hexdigest() for p in ["test/cases.json", "test/stages.test.ts"]
        },
        "fixed": sorted(f"src/stages/stage{n:02d}.ts" for n in BUGGY),
        "visible": visible,
        "extra": extra,
    }
    return files, expected


def main():
    files, expected = build()
    if "--expected" in sys.argv:
        print(json.dumps(expected))
        return
    for path, text in files.items():
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)


if __name__ == "__main__":
    main()
