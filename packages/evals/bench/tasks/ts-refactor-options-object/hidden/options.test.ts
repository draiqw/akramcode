import assert from "node:assert/strict";
import { test } from "node:test";
import { startCluster } from "../src/cluster.ts";
import { startDev } from "../src/dev.ts";
import { healthServer } from "../src/healthcheck.ts";
import { consoleLogger, createServerLogger, MemoryLogger, silentLogger } from "../src/logger.ts";
import { startProduction } from "../src/main.ts";
import * as serverModule from "../src/server.ts";
import { testServer } from "../src/testing/fixtures.ts";

type Create = (options?: Record<string, unknown>) => serverModule.ServerHandle;
const createServer = serverModule.createServer as unknown as Create;

function plain(handle: serverModule.ServerHandle) {
	return { host: handle.host, port: handle.port, tls: handle.tls, timeoutMs: handle.timeoutMs, url: handle.url };
}

test("defaults", () => {
	const a = createServer();
	assert.deepEqual(plain(a), { host: "127.0.0.1", port: 8080, tls: false, timeoutMs: 30000, url: "http://127.0.0.1:8080" });
	assert.equal(a.logger, silentLogger);
	assert.deepEqual(plain(createServer({})), plain(a));
	const b = createServer({ port: 9000 });
	assert.deepEqual(plain(b), { host: "127.0.0.1", port: 9000, tls: false, timeoutMs: 30000, url: "http://127.0.0.1:9000" });
});

test("explicit falsy values are kept", () => {
	const s = createServer({ port: 0, timeoutMs: 0, tls: false, host: "h" });
	assert.deepEqual(plain(s), { host: "h", port: 0, tls: false, timeoutMs: 0, url: "http://h:0" });
	const t = createServer({ tls: true, port: undefined });
	assert.equal(t.url, "https://127.0.0.1:8080");
});

test("handle shape and logging unchanged", () => {
	const logger = new MemoryLogger();
	const s = createServer({ host: "api", port: 81, tls: true, timeoutMs: 5, logger });
	assert.equal(s.url, "https://api:81");
	assert.equal(s.logger, logger);
	s.log("hello");
	assert.deepEqual(logger.lines, ["[api:81] hello"]);
	assert.deepEqual(Object.keys(s).sort(), ["host", "log", "logger", "port", "timeoutMs", "tls", "url"]);
});

test("call sites pass the same values as before", () => {
	const prod = startProduction({ HOST: "10.0.0.1", PORT: "8443" });
	assert.deepEqual(plain(prod), { host: "10.0.0.1", port: 8443, tls: true, timeoutMs: 60000, url: "https://10.0.0.1:8443" });
	assert.equal(prod.logger, consoleLogger);
	assert.deepEqual(plain(startProduction({})), {
		host: "0.0.0.0",
		port: 443,
		tls: true,
		timeoutMs: 60000,
		url: "https://0.0.0.0:443",
	});

	const dev = startDev();
	assert.deepEqual(plain(dev), { host: "localhost", port: 5173, tls: false, timeoutMs: 0, url: "http://localhost:5173" });
	assert.equal(dev.logger, consoleLogger);

	const cluster = startCluster(7000, 3);
	assert.deepEqual(
		cluster.map(plain),
		[7000, 7001, 7002].map((port) => ({ host: "127.0.0.1", port, tls: false, timeoutMs: 30000, url: `http://127.0.0.1:${port}` })),
	);
	assert.ok(cluster.every((s) => s.logger === silentLogger));

	const health = healthServer();
	assert.deepEqual(plain(health), { host: "127.0.0.1", port: 0, tls: false, timeoutMs: 5000, url: "http://127.0.0.1:0" });
	assert.equal(health.logger, silentLogger);
	assert.notEqual(healthServer(true).logger, silentLogger);

	const { server, logger } = testServer(1234);
	assert.deepEqual(plain(server), { host: "test.local", port: 1234, tls: false, timeoutMs: 1000, url: "http://test.local:1234" });
	server.log("x");
	assert.deepEqual(logger.lines, ["[test.local:1234] x"]);
	assert.equal(testServer().server.port, 9999);
});

test("createServerLogger untouched", () => {
	const base = new MemoryLogger();
	createServerLogger("db", base).info("ok");
	assert.deepEqual(base.lines, ["db: ok"]);
});
