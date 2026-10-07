import { consoleLogger } from "./logger.ts";
import { createServer, type ServerHandle } from "./server.ts";

/** Dev server: plain http and no request timeout (0 disables it). */
export function startDev(): ServerHandle {
	return createServer({ host: "localhost", port: 5173, tls: false, timeoutMs: 0, logger: consoleLogger });
}
