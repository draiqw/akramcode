import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AuthError } from "../src/auth.ts";
import { loadRoutes } from "../src/load-routes.ts";
import type { Ctx } from "../src/types.ts";

interface Expected {
	routes: Record<string, { key: string; public: boolean; reply: unknown }>;
	changed: string[];
}

const expected: Expected = JSON.parse(readFileSync(new URL("./expected.json", import.meta.url), "utf8"));

function makeCtx(withUser: boolean): { ctx: Ctx; calls: string[] } {
	const calls: string[] = [];
	const ctx: Ctx = {
		params: { id: "42", page: "intro" },
		body: { name: "x" },
		db: {
			async get(key) {
				calls.push(`get ${key}`);
				return { key };
			},
			async list(prefix) {
				calls.push(`list ${prefix}`);
				return [`${prefix}:1`, `${prefix}:2`];
			},
			async put(key) {
				calls.push(`put ${key}`);
				return true;
			},
		},
	};
	if (withUser) ctx.user = { id: "u1", roles: ["member"] };
	return { ctx, calls };
}

function stripComments(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function firstStatementIsRequireAuth(file: string): boolean {
	const src = readFileSync(file, "utf8");
	const at = src.indexOf("function handler");
	assert.ok(at >= 0, `${file}: handler not found`);
	const open = src.indexOf("{", at);
	const rest = stripComments(src.slice(open + 1)).trimStart();
	return /^requireAuth\s*\(\s*ctx\s*\)\s*;?/.test(rest);
}

test("route set is unchanged", async () => {
	const routes = await loadRoutes();
	assert.deepEqual(routes.map((r) => r.file).sort(), Object.keys(expected.routes).sort());
	for (const r of routes) assert.equal(`${r.route.method} ${r.route.path}`, expected.routes[r.file].key);
});

test("private routes reject anonymous requests before touching the database", async () => {
	for (const r of await loadRoutes()) {
		const exp = expected.routes[r.file];
		if (exp.public) continue;
		assert.ok(firstStatementIsRequireAuth(r.file), `${exp.key}: requireAuth(ctx) is not the first statement`);
		const { ctx, calls } = makeCtx(false);
		await assert.rejects(r.handler(ctx), AuthError, `${exp.key} must reject anonymous requests`);
		assert.deepEqual(calls, [], `${exp.key} touched the database before authenticating`);
	}
});

test("public routes accept anonymous requests and do not call requireAuth", async () => {
	for (const r of await loadRoutes()) {
		const exp = expected.routes[r.file];
		if (!exp.public) continue;
		assert.ok(!/requireAuth\s*\(/.test(stripComments(readFileSync(r.file, "utf8"))), `${exp.key} calls requireAuth`);
		const { ctx } = makeCtx(false);
		assert.deepEqual(await r.handler(ctx), exp.reply, exp.key);
	}
});

test("authenticated behavior is unchanged", async () => {
	for (const r of await loadRoutes()) {
		const exp = expected.routes[r.file];
		const { ctx } = makeCtx(true);
		assert.deepEqual(await r.handler(ctx), exp.reply, exp.key);
	}
});

test("AUDIT.json lists exactly the changed routes", () => {
	const audit = JSON.parse(readFileSync("AUDIT.json", "utf8"));
	assert.deepEqual(audit.changed, expected.changed);
});
