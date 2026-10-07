import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { STAGES } from "../src/stages/index.ts";

interface Expected {
	hashes: Record<string, string>;
	fixed: string[];
	visible: Record<string, [number[], number[]][]>;
	extra: Record<string, [number[], number[]][]>;
}

const expected: Expected = JSON.parse(readFileSync(new URL("./expected.json", import.meta.url), "utf8"));

test("all 40 stages are registered", () => {
	assert.equal(STAGES.length, 40);
	assert.deepEqual(
		STAGES.map((s) => s.STAGE_ID),
		Array.from({ length: 40 }, (_, i) => `stage${String(i + 1).padStart(2, "0")}`),
	);
});

test("test files were not modified", () => {
	for (const [path, hash] of Object.entries(expected.hashes)) {
		const actual = createHash("sha256").update(readFileSync(path, "utf8")).digest("hex");
		assert.equal(actual, hash, `${path} was modified`);
	}
});

for (const stage of STAGES) {
	test(`${stage.STAGE_ID} matches its spec`, () => {
		const cases = [...expected.visible[stage.STAGE_ID], ...expected.extra[stage.STAGE_ID]];
		for (const [input, want] of cases) {
			const frozen = Object.freeze([...input]);
			const got = stage.run(frozen);
			assert.equal(JSON.stringify(got), JSON.stringify(want), `${stage.STAGE_ID} input=${JSON.stringify(input)}`);
		}
	});
}

test("FIXED.json lists exactly the modules that contained bugs", () => {
	const fixed: unknown = JSON.parse(readFileSync("FIXED.json", "utf8"));
	assert.ok(Array.isArray(fixed));
	const normalized = (fixed as string[]).map((p) => p.replace(/^\.\//, ""));
	assert.deepEqual(normalized, expected.fixed);
});
