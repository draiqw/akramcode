import type { Logger } from "./logger.ts";

export interface ServerHandle {
	host: string;
	port: number;
	tls: boolean;
	timeoutMs: number;
	logger: Logger;
	url: string;
	log(message: string): void;
}

export function createServer(host: string, port: number, tls: boolean, timeoutMs: number, logger: Logger): ServerHandle {
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
