import assert from "node:assert/strict";
import { test } from "node:test";
import { loadRoutes } from "../src/load-routes.ts";
import type { Db } from "../src/types.ts";

function fakeDb(): Db {
	return {
		async get(key) {
			return { key };
		},
		async list(prefix) {
			return [`${prefix}:1`, `${prefix}:2`];
		},
		async put() {
			return true;
		},
	};
}

test("every route module exports a unique route and a handler", async () => {
	const routes = await loadRoutes();
	assert.ok(routes.length > 50);
	const seen = new Set<string>();
	for (const r of routes) {
		const key = `${r.route.method} ${r.route.path}`;
		assert.ok(!seen.has(key), `duplicate route ${key}`);
		seen.add(key);
		assert.equal(typeof r.handler, "function", r.file);
	}
});

test("authenticated requests succeed on every route", async () => {
	for (const r of await loadRoutes()) {
		const reply = await r.handler({
			user: { id: "u1", roles: ["member"] },
			params: { id: "42", page: "intro" },
			body: { name: "x" },
			db: fakeDb(),
		});
		console.log(`${r.route.method.padEnd(6)} ${r.route.path.padEnd(36)} ${r.file} -> ${reply.status}`);
		assert.ok(reply.status < 400, r.file);
	}
});
