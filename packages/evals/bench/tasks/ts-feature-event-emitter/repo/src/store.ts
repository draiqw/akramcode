import { Emitter } from "./emitter.ts";

/** Key-value store that emits "set" and "delete" events. */
export class Store<V> extends Emitter {
	private readonly data = new Map<string, V>();

	get(key: string): V | undefined {
		return this.data.get(key);
	}

	set(key: string, value: V): void {
		const previous = this.data.get(key);
		this.data.set(key, value);
		this.emit("set", key, value, previous);
	}

	delete(key: string): boolean {
		const existed = this.data.delete(key);
		if (existed) this.emit("delete", key);
		return existed;
	}
}
