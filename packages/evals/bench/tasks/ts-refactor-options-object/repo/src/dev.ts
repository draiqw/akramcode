import { consoleLogger } from "./logger.ts";
import { createServer, type ServerHandle } from "./server.ts";

/** Dev server: plain http and no request timeout (0 disables it). */
export function startDev(): ServerHandle {
	return createServer("localhost", 5173, false, 0, consoleLogger);
}
