import { createServerLogger, silentLogger } from "./logger.ts";
import { createServer, type ServerHandle } from "./server.ts";

/** Health endpoint on an ephemeral port (0) with a short timeout. */
export function healthServer(verbose = false): ServerHandle {
	const logger = verbose ? createServerLogger("health") : silentLogger;
	return createServer("127.0.0.1", 0, false, 5_000, logger);
}
