import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogStats } from "../src/routes/catalog.ts";
import { createApp } from "../src/server/createApp.ts";

const req = (method: string, path: string, headers: Record<string, string> = {}, ip = "10.0.0.1", body?: string) => ({
	method,
	path,
	headers,
	ip,
	body,
});
const alice = { authorization: "Bearer tok-alice" };
const bob = { authorization: "Bearer tok-bob" };

test("each user gets their own profile", async () => {
	const { app } = createApp();
	for (let round = 0; round < 3; round++) {
		const a = await app.handle(req("GET", "/api/me", alice));
		const b = await app.handle(req("GET", "/api/me", bob, "10.0.0.2"));
		assert.equal(a.status, 200);
		assert.equal(b.status, 200);
		assert.equal((a.body as { id: string }).id, "u-alice");
		assert.equal((b.body as { id: string }).id, "u-bob");
	}
});

test("anonymous /api/me is 401 even after a user requested it", async () => {
	const { app } = createApp();
	await app.handle(req("GET", "/api/me", alice));
	await app.handle(req("GET", "/api/me", alice));
	const anon = await app.handle(req("GET", "/api/me", {}, "10.0.0.9"));
	assert.equal(anon.status, 401);
	assert.ok(anon.headers["x-request-id"]);
	const badToken = await app.handle(req("GET", "/api/me", { authorization: "Bearer nope" }));
	assert.equal(badToken.status, 401);
});

test("CORS preflight needs no auth", async () => {
	const { app } = createApp();
	const res = await app.handle(req("OPTIONS", "/api/me"));
	assert.equal(res.status, 204);
	assert.equal(res.headers["access-control-allow-origin"], "*");
	assert.ok(res.headers["x-request-id"]);
});

test("rate limit applies to unauthenticated requests", async () => {
	const { app } = createApp({ rateLimit: 3 });
	const statuses: number[] = [];
	for (let i = 0; i < 5; i++) statuses.push((await app.handle(req("GET", "/api/me", {}, "10.9.9.9"))).status);
	assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
	const limited = await app.handle(req("GET", "/health", {}, "10.9.9.9"));
	assert.equal(limited.status, 429);
	assert.ok(limited.headers["x-request-id"]);
	assert.equal((await app.handle(req("GET", "/health", {}, "10.1.1.1"))).status, 200);
});

test("public catalog is cached; health is public", async () => {
	const { app } = createApp();
	const before = catalogStats.calls;
	const first = await app.handle(req("GET", "/api/catalog"));
	const second = await app.handle(req("GET", "/api/catalog", {}, "10.0.0.3"));
	assert.equal(first.status, 200);
	assert.equal(second.status, 200);
	assert.deepEqual(second.body, first.body);
	assert.equal(second.headers["x-cache"], "HIT");
	assert.equal(catalogStats.calls - before, 1);
	assert.equal((await app.handle(req("GET", "/health"))).status, 200);
});

test("request ids are distinct and orders still work", async () => {
	const { app, logSink } = createApp();
	const r1 = await app.handle(req("GET", "/health"));
	const r2 = await app.handle(req("GET", "/health"));
	assert.notEqual(r1.headers["x-request-id"], r2.headers["x-request-id"]);
	const order = await app.handle(req("POST", "/api/orders", alice, "10.0.0.1", '{"sku":"p-2","qty":2}'));
	assert.equal(order.status, 201);
	assert.deepEqual(order.body, { id: 1, sku: "p-2", qty: 2, user: "u-alice" });
	const unauthOrder = await app.handle(req("POST", "/api/orders", {}, "10.0.0.1", '{"sku":"p-2"}'));
	assert.equal(unauthOrder.status, 401);
	assert.equal(logSink.lines.length, 4);
});
