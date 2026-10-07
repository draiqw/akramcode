export type Listener = (...args: any[]) => void;

interface Registration {
	listener: Listener;
	once: boolean;
	removed: boolean;
}

/** Minimal synchronous event emitter. */
export class Emitter {
	private readonly listeners = new Map<string, Registration[]>();

	private add(event: string, listener: Listener, once: boolean): this {
		const list = this.listeners.get(event) ?? [];
		list.push({ listener, once, removed: false });
		this.listeners.set(event, list);
		return this;
	}

	private remove(event: string, registration: Registration): void {
		const list = this.listeners.get(event);
		if (!list) return;
		const index = list.indexOf(registration);
		if (index >= 0) list.splice(index, 1);
		registration.removed = true;
	}

	on(event: string, listener: Listener): this {
		return this.add(event, listener, false);
	}

	once(event: string, listener: Listener): this {
		return this.add(event, listener, true);
	}

	off(event: string, listener: Listener): this {
		const registration = this.listeners.get(event)?.find((entry) => entry.listener === listener);
		if (registration) this.remove(event, registration);
		return this;
	}

	/** Call every listener of `event` with `args`, then wildcard listeners. Returns true if any listener ran. */
	emit(event: string, ...args: unknown[]): boolean {
		if (event === "*") throw new TypeError('cannot emit the wildcard event "*"');
		const specific = [...(this.listeners.get(event) ?? [])];
		const wildcard = [...(this.listeners.get("*") ?? [])];
		let called = false;
		for (const entry of specific) {
			if (entry.removed) continue;
			if (entry.once) this.remove(event, entry);
			called = true;
			entry.listener(...args);
		}
		for (const entry of wildcard) {
			if (entry.removed) continue;
			if (entry.once) this.remove("*", entry);
			called = true;
			entry.listener(event, ...args);
		}
		return called;
	}

	listenerCount(event: string): number {
		return this.listeners.get(event)?.length ?? 0;
	}
}
