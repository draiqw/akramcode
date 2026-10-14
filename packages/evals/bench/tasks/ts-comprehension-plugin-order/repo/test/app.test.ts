import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/server/createApp.ts";

const req = (method: string, path: string, headers: Record<string, string> = {}, body?: string) => ({
	method,
	path,
	headers,
	ip: "10.0.0.1",
	body,
});

test("health is public", async () => {
	const { app } = createApp();
	const res = await app.handle(req("GET", "/health"));
	assert.equal(res.status, 200);
	assert.deepEqual(res.body, { ok: true });
});

test("me requires a token", async () => {
	const { app } = createApp();
	assert.equal((await app.handle(req("GET", "/api/me"))).status, 401);
	const res = await app.handle(req("GET", "/api/me", { Authorization: "Bearer tok-alice" }));
	assert.equal(res.status, 200);
	assert.equal((res.body as { name: string }).name, "Alice");
});

test("orders", async () => {
	const { app } = createApp();
	const res = await app.handle(req("POST", "/api/orders", { authorization: "Bearer tok-bob" }, '{"sku":"p-1"}'));
	assert.equal(res.status, 201);
});
