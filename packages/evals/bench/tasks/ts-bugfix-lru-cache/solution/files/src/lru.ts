/** Fixed-capacity cache that evicts the least recently used entry. */
export class LRUCache<K, V> {
	readonly capacity: number;
	private readonly map = new Map<K, V>();

	constructor(capacity: number) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
		}
		this.capacity = capacity;
	}

	get(key: K): V | undefined {
		if (!this.map.has(key)) return undefined;
		const value = this.map.get(key) as V;
		this.map.delete(key);
		this.map.set(key, value);
		return value;
	}

	has(key: K): boolean {
		return this.map.has(key);
	}

	set(key: K, value: V): this {
		if (this.map.has(key)) this.map.delete(key);
		this.map.set(key, value);
		if (this.map.size > this.capacity) {
			const oldest = this.map.keys().next().value as K;
			this.map.delete(oldest);
		}
		return this;
	}

	delete(key: K): boolean {
		return this.map.delete(key);
	}

	get size(): number {
		return this.map.size;
	}

	/** Keys from least to most recently used. */
	keys(): K[] {
		return [...this.map.keys()];
	}
}
