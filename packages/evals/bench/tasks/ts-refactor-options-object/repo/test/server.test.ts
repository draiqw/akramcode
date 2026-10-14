import assert from "node:assert/strict";
import { test } from "node:test";
import { startCluster } from "../src/cluster.ts";
import { startDev } from "../src/dev.ts";
import { healthServer } from "../src/healthcheck.ts";
import { MemoryLogger } from "../src/logger.ts";
import { startProduction } from "../src/main.ts";
import { createServer } from "../src/server.ts";
import { testServer } from "../src/testing/fixtures.ts";

test("createServer builds url and logs with prefix", () => {
	const logger = new MemoryLogger();
	const server = createServer("example.com", 8443, true, 10, logger);
	assert.equal(server.url, "https://example.com:8443");
	server.log("up");
	assert.deepEqual(logger.lines, ["[example.com:8443] up"]);
});

test("call sites", () => {
	assert.equal(startProduction({ PORT: "8443" }).url, "https://0.0.0.0:8443");
	assert.equal(startDev().timeoutMs, 0);
	assert.deepEqual(
		startCluster(7000, 2).map((s) => s.port),
		[7000, 7001],
	);
	assert.equal(healthServer().port, 0);
	assert.equal(testServer().server.host, "test.local");
});
