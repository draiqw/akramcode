import { silentLogger } from "./logger.ts";
import { createServer, type ServerHandle } from "./server.ts";

export function startCluster(basePort: number, count: number): ServerHandle[] {
	const servers: ServerHandle[] = [];
	for (let i = 0; i < count; i++) {
		servers.push(createServer({ host: "127.0.0.1", port: basePort + i, tls: false, timeoutMs: 30_000, logger: silentLogger }));
	}
	return servers;
}
