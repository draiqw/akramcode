import { MemoryLogger } from "../logger.ts";
import { createServer, type ServerHandle } from "../server.ts";

export function testServer(port = 9999): { server: ServerHandle; logger: MemoryLogger } {
	const logger = new MemoryLogger();
	const server = createServer("test.local", port, false, 1_000, logger);
	return { server, logger };
}
