import { silentLogger } from "./logger.ts";
import { createServer, type ServerHandle } from "./server.ts";

export function startCluster(basePort: number, count: number): ServerHandle[] {
	const servers: ServerHandle[] = [];
	for (let i = 0; i < count; i++) {
		servers.push(createServer("127.0.0.1", basePort + i, false, 30_000, silentLogger));
	}
	return servers;
}
