import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "../src/cli.ts";
import type { Item } from "../src/types.ts";

const ITEMS: Item[] = [
	{ id: 1, name: "write spec", done: true },
	{ id: 2, name: "review PR", done: false },
	{ id: 3, name: "ship", done: false },
	{ id: 4, name: "celebrate", done: false },
];

const LIMIT_ERROR = { exitCode: 2, stdout: "", stderr: "error: --limit must be a positive integer\n" };

test("existing behavior unchanged", () => {
	assert.deepEqual(main(["list"], ITEMS), { exitCode: 0, stdout: "2\treview PR\n3\tship\n4\tcelebrate\n", stderr: "" });
	assert.deepEqual(main(["list", "--nope"], ITEMS), { exitCode: 2, stdout: "", stderr: "error: unknown flag --nope\n" });
	assert.deepEqual(main(["frob"], ITEMS), { exitCode: 2, stdout: "", stderr: "error: unknown command frob\n" });
	assert.equal(main(["count"], ITEMS).stdout, "4 items, 1 done\n");
	assert.equal(main(["list"], [{ id: 1, name: "x", done: true }]).stdout, "no items\n");
});

test("--json prints open items", () => {
	const expected = ITEMS.filter((item) => !item.done);
	assert.deepEqual(main(["list", "--json"], ITEMS), {
		exitCode: 0,
		stdout: `${JSON.stringify(expected, null, 2)}\n`,
		stderr: "",
	});
});

test("--json with --all and empty selection", () => {
	assert.equal(main(["list", "--all", "--json"], ITEMS).stdout, `${JSON.stringify(ITEMS, null, 2)}\n`);
	assert.equal(main(["list", "--json"], [{ id: 9, name: "z", done: true }]).stdout, "[]\n");
});

test("--limit with space and equals", () => {
	assert.equal(main(["list", "--limit", "2"], ITEMS).stdout, "2\treview PR\n3\tship\n");
	assert.equal(main(["list", "--limit=1"], ITEMS).stdout, "2\treview PR\n");
	assert.equal(main(["list", "--limit", "10"], ITEMS).stdout, "2\treview PR\n3\tship\n4\tcelebrate\n");
});

test("--limit after the done filter", () => {
	assert.equal(main(["list", "--all", "--limit", "2"], ITEMS).stdout, "1\twrite spec\n2\treview PR\n");
	assert.equal(main(["list", "--limit", "2", "--all"], ITEMS).stdout, "1\twrite spec\n2\treview PR\n");
});

test("--limit combined with --json in any order", () => {
	const expected = `${JSON.stringify([ITEMS[1]], null, 2)}\n`;
	assert.equal(main(["list", "--json", "--limit", "1"], ITEMS).stdout, expected);
	assert.equal(main(["list", "--limit", "1", "--json"], ITEMS).stdout, expected);
	assert.equal(main(["list", "--limit=1", "--json"], ITEMS).stdout, expected);
	assert.equal(main(["list", "--all", "--limit=2", "--json"], ITEMS).stdout, `${JSON.stringify(ITEMS.slice(0, 2), null, 2)}\n`);
});

test("invalid limits", () => {
	for (const argv of [
		["list", "--limit"],
		["list", "--limit", "0"],
		["list", "--limit", "-1"],
		["list", "--limit", "abc"],
		["list", "--limit", "1.5"],
		["list", "--limit="],
		["list", "--limit=0"],
		["list", "--limit=2x"],
		["list", "--limit", "--json"],
	]) {
		assert.deepEqual(main(argv, ITEMS), LIMIT_ERROR, argv.join(" "));
	}
});
