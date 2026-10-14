export interface Logger {
	info(message: string): void;
}

export const consoleLogger: Logger = {
	info(message: string) {
		console.log(message);
	},
};

export const silentLogger: Logger = {
	info() {},
};

/** Prefixes every message with a component name. Unrelated to createServer's signature. */
export function createServerLogger(component: string, base: Logger = consoleLogger): Logger {
	return { info: (message) => base.info(`${component}: ${message}`) };
}

export class MemoryLogger implements Logger {
	readonly lines: string[] = [];
	info(message: string): void {
		this.lines.push(message);
	}
}
