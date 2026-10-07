import assert from "node:assert/strict";
import { test } from "node:test";
import { LRUCache } from "../src/lru.ts";
import { memoize } from "../src/memo.ts";

test("get refreshes recency", () => {
	const cache = new LRUCache<string, number>(3);
	cache.set("a", 1).set("b", 2).set("c", 3);
	assert.equal(cache.get("a"), 1);
	assert.deepEqual(cache.keys(), ["b", "c", "a"]);
	cache.set("d", 4);
	assert.deepEqual(cache.keys(), ["c", "a", "d"]);
	assert.equal(cache.has("b"), false);
});

test("missing get does not change order", () => {
	const cache = new LRUCache<string, number>(2);
	cache.set("a", 1).set("b", 2);
	assert.equal(cache.get("zzz"), undefined);
	assert.deepEqual(cache.keys(), ["a", "b"]);
});

test("has does not refresh recency", () => {
	const cache = new LRUCache<string, number>(2);
	cache.set("a", 1).set("b", 2);
	assert.equal(cache.has("a"), true);
	cache.set("c", 3);
	assert.deepEqual(cache.keys(), ["b", "c"]);
});

test("updating existing key keeps size and refreshes", () => {
	const cache = new LRUCache<string, number>(2);
	cache.set("a", 1).set("b", 2);
	cache.set("a", 10);
	assert.equal(cache.size, 2);
	assert.equal(cache.get("a"), 10);
	assert.deepEqual(cache.keys(), ["b", "a"]);
	cache.set("a", 11).set("a", 12);
	assert.equal(cache.size, 2);
	cache.set("c", 3);
	assert.deepEqual(cache.keys(), ["a", "c"]);
	assert.equal(cache.get("a"), 12);
});

test("delete reduces size", () => {
	const cache = new LRUCache<string, number>(3);
	cache.set("a", 1).set("b", 2);
	assert.equal(cache.delete("a"), true);
	assert.equal(cache.delete("a"), false);
	assert.equal(cache.size, 1);
	cache.set("c", 3).set("d", 4);
	assert.equal(cache.size, 3);
	assert.deepEqual(cache.keys(), ["b", "c", "d"]);
});

test("capacity one", () => {
	const cache = new LRUCache<number, string>(1);
	cache.set(1, "x").set(2, "y");
	assert.deepEqual(cache.keys(), [2]);
	assert.equal(cache.size, 1);
});

test("invalid capacity", () => {
	assert.throws(() => new LRUCache(0), RangeError);
	assert.throws(() => new LRUCache(1.5), RangeError);
});

test("memoize uses LRU eviction", () => {
	let calls = 0;
	const square = memoize((n: number) => {
		calls++;
		return n * n;
	}, 2);
	square(1);
	square(2);
	square(1);
	square(3);
	assert.equal(calls, 3);
	square(1);
	assert.equal(calls, 3);
	square(2);
	assert.equal(calls, 4);
	assert.equal(square.cache.size, 2);
});
