export type Listener = (...args: any[]) => void;

/** Minimal synchronous event emitter. */
export class Emitter {
	private readonly listeners = new Map<string, Listener[]>();

	on(event: string, listener: Listener): this {
		const list = this.listeners.get(event) ?? [];
		list.push(listener);
		this.listeners.set(event, list);
		return this;
	}

	/** Call every listener of `event` with `args`. Returns true if any listener ran. */
	emit(event: string, ...args: unknown[]): boolean {
		const list = this.listeners.get(event);
		if (!list || list.length === 0) return false;
		for (const listener of [...list]) listener(...args);
		return true;
	}

	listenerCount(event: string): number {
		return this.listeners.get(event)?.length ?? 0;
	}
}
