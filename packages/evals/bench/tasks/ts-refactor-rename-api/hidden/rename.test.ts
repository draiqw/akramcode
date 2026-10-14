import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as root from "../src/index.ts";
import * as usersApi from "../src/api/users.ts";
import * as apiIndex from "../src/api/index.ts";
import { MemoryUserStore } from "../src/db.ts";
import { fetchUserDataset } from "../src/analytics/dataset.ts";
import { handleGetUser } from "../src/handlers/admin.ts";
import { loadMany } from "../src/handlers/batch.ts";
import { annualCharge, monthlyCharge } from "../src/services/billing.ts";
import { buildProfileCard } from "../src/services/profile.ts";

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else if (p.endsWith(".ts")) out.push(p);
	}
	return out;
}

test("old identifier is gone from src/ and test/", () => {
	const offenders: string[] = [];
	for (const dir of ["src", "test"]) {
		for (const file of walk(dir)) {
			if (/\bfetchUserData\b/.test(readFileSync(file, "utf8"))) offenders.push(file);
		}
	}
	assert.deepEqual(offenders, []);
});

test("loadUser is exported from users.ts, api/index.ts and src/index.ts; old name is not", () => {
	const mods: Record<string, unknown>[] = [usersApi, apiIndex, root];
	for (const mod of mods) {
		assert.equal(typeof mod.loadUser, "function");
		assert.equal("fetchUserData" in mod, false);
	}
	assert.equal(typeof (root as Record<string, unknown>).fetchUserDataset, "function");
});

test("loadUser behavior unchanged", () => {
	const loadUser = (usersApi as Record<string, unknown>).loadUser as (id: string, store?: unknown) => { name: string };
	assert.equal(loadUser("  U1 ").name, "Ada Lovelace");
	assert.throws(() => loadUser("missing"), usersApi.UserNotFoundError);
	const store = new MemoryUserStore([
		{ id: "k1", name: "Ken", email: "k@example.com", plan: "free", active: true },
	]);
	assert.equal(loadUser("K1", store).name, "Ken");
	assert.equal(usersApi.userExists("u3"), true);
	assert.equal(usersApi.userExists("nobody"), false);
});

test("call sites still work", () => {
	assert.deepEqual(buildProfileCard("u3"), { title: "Grace Hopper [ENTERPRISE]", subtitle: "grace@example.com" });
	assert.equal(monthlyCharge("u1"), 12);
	assert.equal(annualCharge("u2"), 0);
	assert.equal(handleGetUser("U2").status, 200);
	assert.equal(handleGetUser("x").status, 404);
	assert.deepEqual(
		loadMany(["u3", "?", "u1"]).map((u) => u.id),
		["u3", "u1"],
	);
	assert.deepEqual(fetchUserDataset(["u1", "u7"]), [
		["u1", true],
		["u7", false],
	]);
});
