import { LRUCache } from "./lru.ts";

/** Memoize a single-argument function with an LRU cache of the given capacity. */
export function memoize<A, R>(fn: (arg: A) => R, capacity = 100): ((arg: A) => R) & { cache: LRUCache<A, R> } {
	const cache = new LRUCache<A, R>(capacity);
	const wrapped = (arg: A): R => {
		if (cache.has(arg)) return cache.get(arg) as R;
		const result = fn(arg);
		cache.set(arg, result);
		return result;
	};
	return Object.assign(wrapped, { cache });
}
