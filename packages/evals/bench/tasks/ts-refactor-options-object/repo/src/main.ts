import { consoleLogger } from "./logger.ts";
import { createServer, type ServerHandle } from "./server.ts";

export function startProduction(env: Record<string, string | undefined>): ServerHandle {
	const host = env.HOST ?? "0.0.0.0";
	const port = Number(env.PORT ?? "443");
	const server = createServer(host, port, true, 60_000, consoleLogger);
	return server;
}
