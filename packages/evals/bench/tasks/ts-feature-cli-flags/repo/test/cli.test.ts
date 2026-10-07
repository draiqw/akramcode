import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "../src/cli.ts";
import type { Item } from "../src/types.ts";

const ITEMS: Item[] = [
	{ id: 1, name: "write spec", done: true },
	{ id: 2, name: "review PR", done: false },
	{ id: 3, name: "ship", done: false },
];

test("list shows open items", () => {
	assert.deepEqual(main(["list"], ITEMS), { exitCode: 0, stdout: "2\treview PR\n3\tship\n", stderr: "" });
});

test("list --all shows everything", () => {
	assert.equal(main(["list", "--all"], ITEMS).stdout, "1\twrite spec\n2\treview PR\n3\tship\n");
});

test("unknown flag", () => {
	assert.deepEqual(main(["list", "--nope"], ITEMS), { exitCode: 2, stdout: "", stderr: "error: unknown flag --nope\n" });
});

test("count", () => {
	assert.equal(main(["count"], ITEMS).stdout, "3 items, 1 done\n");
});
