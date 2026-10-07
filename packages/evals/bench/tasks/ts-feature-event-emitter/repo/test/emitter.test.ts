import assert from "node:assert/strict";
import { test } from "node:test";
import { Emitter } from "../src/emitter.ts";
import { Store } from "../src/store.ts";

test("on and emit", () => {
	const emitter = new Emitter();
	const seen: unknown[] = [];
	emitter.on("x", (a, b) => seen.push([a, b]));
	assert.equal(emitter.emit("x", 1, 2), true);
	assert.equal(emitter.emit("y"), false);
	assert.deepEqual(seen, [[1, 2]]);
});

test("store emits set", () => {
	const store = new Store<number>();
	const seen: unknown[] = [];
	store.on("set", (key, value, previous) => seen.push([key, value, previous]));
	store.set("a", 1);
	store.set("a", 2);
	assert.deepEqual(seen, [
		["a", 1, undefined],
		["a", 2, 1],
	]);
});
