import assert from "node:assert/strict";
import { test } from "node:test";
import { LRUCache } from "../src/lru.ts";

test("stores and returns values", () => {
	const cache = new LRUCache<string, number>(2);
	cache.set("a", 1);
	assert.equal(cache.get("a"), 1);
	assert.equal(cache.get("missing"), undefined);
});

test("evicts least recently used", () => {
	const cache = new LRUCache<string, number>(2);
	cache.set("a", 1).set("b", 2);
	cache.get("a");
	cache.set("c", 3);
	assert.deepEqual(cache.keys(), ["a", "c"]);
});
