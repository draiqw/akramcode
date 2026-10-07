/** Fixed-capacity cache that evicts the least recently used entry. */
export class LRUCache<K, V> {
	readonly capacity: number;
	private readonly map = new Map<K, V>();
	private count = 0;

	constructor(capacity: number) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
		}
		this.capacity = capacity;
	}

	get(key: K): V | undefined {
		return this.map.get(key);
	}

	has(key: K): boolean {
		return this.map.has(key);
	}

	set(key: K, value: V): this {
		this.map.set(key, value);
		this.count++;
		if (this.count > this.capacity) {
			const newest = [...this.map.keys()].pop() as K;
			this.map.delete(newest);
			this.count--;
		}
		return this;
	}

	delete(key: K): boolean {
		return this.map.delete(key);
	}

	get size(): number {
		return this.count;
	}

	/** Keys from least to most recently used. */
	keys(): K[] {
		return [...this.map.keys()];
	}
}
