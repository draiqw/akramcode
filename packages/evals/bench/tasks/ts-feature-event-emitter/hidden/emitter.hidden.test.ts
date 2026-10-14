import assert from "node:assert/strict";
import { test } from "node:test";
import { Emitter } from "../src/emitter.ts";
import { Store } from "../src/store.ts";

test("once runs once and is removed", () => {
	const emitter = new Emitter();
	const seen: unknown[] = [];
	assert.equal(emitter.once("x", (v) => seen.push(v)), emitter);
	assert.equal(emitter.listenerCount("x"), 1);
	assert.equal(emitter.emit("x", 1), true);
	assert.equal(emitter.emit("x", 2), false);
	assert.deepEqual(seen, [1]);
	assert.equal(emitter.listenerCount("x"), 0);
});

test("once listener removed before invocation (re-entrant emit)", () => {
	const emitter = new Emitter();
	let calls = 0;
	emitter.once("x", () => {
		calls++;
		emitter.emit("x");
	});
	emitter.emit("x");
	assert.equal(calls, 1);
});

test("off removes earliest registration only", () => {
	const emitter = new Emitter();
	const seen: string[] = [];
	const a = () => seen.push("a");
	const b = () => seen.push("b");
	emitter.on("x", a).on("x", b).on("x", a);
	assert.equal(emitter.off("x", a), emitter);
	emitter.emit("x");
	assert.deepEqual(seen, ["b", "a"]);
	assert.equal(emitter.listenerCount("x"), 2);
	emitter.off("x", () => {});
	emitter.off("nope", a);
	assert.equal(emitter.listenerCount("x"), 2);
});

test("off works for once listeners with original function", () => {
	const emitter = new Emitter();
	let called = false;
	const listener = () => {
		called = true;
	};
	emitter.once("x", listener);
	emitter.off("x", listener);
	assert.equal(emitter.listenerCount("x"), 0);
	assert.equal(emitter.emit("x"), false);
	assert.equal(called, false);
});

test("wildcard receives event name after specific listeners", () => {
	const emitter = new Emitter();
	const seen: unknown[] = [];
	emitter.on("*", (name, ...args) => seen.push(["star1", name, ...args]));
	emitter.on("x", (...args) => seen.push(["x", ...args]));
	emitter.on("*", (name) => seen.push(["star2", name]));
	assert.equal(emitter.emit("x", 1, 2), true);
	assert.equal(emitter.emit("y", 3), true);
	assert.deepEqual(seen, [
		["x", 1, 2],
		["star1", "x", 1, 2],
		["star2", "x"],
		["star1", "y", 3],
		["star2", "y"],
	]);
	assert.equal(emitter.listenerCount("*"), 2);
	assert.equal(emitter.listenerCount("x"), 1);
});

test("wildcard once and off", () => {
	const emitter = new Emitter();
	const seen: string[] = [];
	const star = (name: string) => seen.push(`star:${name}`);
	emitter.once("*", (name: string) => seen.push(`once:${name}`));
	emitter.on("*", star);
	emitter.emit("a");
	emitter.off("*", star);
	assert.equal(emitter.emit("b"), false);
	assert.deepEqual(seen, ["once:a", "star:a"]);
});

test("emit('*') throws TypeError", () => {
	const emitter = new Emitter();
	emitter.on("*", () => {});
	assert.throws(() => emitter.emit("*"), TypeError);
});

test("listeners added during emit are not called", () => {
	const emitter = new Emitter();
	const seen: string[] = [];
	emitter.on("x", () => {
		seen.push("first");
		emitter.on("x", () => seen.push("late"));
		emitter.on("*", () => seen.push("late-star"));
	});
	emitter.emit("x");
	assert.deepEqual(seen, ["first"]);
	emitter.emit("x");
	assert.deepEqual(seen, ["first", "first", "late", "late-star"]);
});

test("listeners removed during emit are skipped", () => {
	const emitter = new Emitter();
	const seen: string[] = [];
	const second = () => seen.push("second");
	const star = () => seen.push("star");
	emitter.on("x", () => {
		seen.push("first");
		emitter.off("x", second);
		emitter.off("*", star);
	});
	emitter.on("x", second);
	emitter.on("*", star);
	emitter.emit("x");
	assert.deepEqual(seen, ["first"]);
});

test("store events reach wildcard listeners", () => {
	const store = new Store<number>();
	const seen: unknown[] = [];
	store.on("*", (...args) => seen.push(args));
	store.set("a", 1);
	store.delete("a");
	store.delete("a");
	assert.deepEqual(seen, [
		["set", "a", 1, undefined],
		["delete", "a"],
	]);
});
