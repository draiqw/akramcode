import { type Logger, silentLogger } from "./logger.ts";

export interface ServerHandle {
	host: string;
	port: number;
	tls: boolean;
	timeoutMs: number;
	logger: Logger;
	url: string;
	log(message: string): void;
}

export interface ServerOptions {
	host?: string;
	port?: number;
	tls?: boolean;
	timeoutMs?: number;
	logger?: Logger;
}

export function createServer(options: ServerOptions = {}): ServerHandle {
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 8080;
	const tls = options.tls ?? false;
	const timeoutMs = options.timeoutMs ?? 30_000;
	const logger = options.logger ?? silentLogger;
	const url = `${tls ? "https" : "http"}://${host}:${port}`;
	return {
		host,
		port,
		tls,
		timeoutMs,
		logger,
		url,
		log(message: string) {
			logger.info(`[${host}:${port}] ${message}`);
		},
	};
}
