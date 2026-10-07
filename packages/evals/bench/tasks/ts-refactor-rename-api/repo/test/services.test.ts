import assert from "node:assert/strict";
import { test } from "node:test";
import { handleGetUser } from "../src/handlers/admin.ts";
import { loadMany } from "../src/handlers/batch.ts";
import { annualCharge, monthlyCharge } from "../src/services/billing.ts";
import { buildProfileCard } from "../src/services/profile.ts";

test("profile card", () => {
	assert.deepEqual(buildProfileCard("u1"), { title: "Ada Lovelace [PRO]", subtitle: "ada@example.com" });
});

test("billing", () => {
	assert.equal(monthlyCharge("u1"), 12);
	assert.equal(monthlyCharge("u3"), 0);
	assert.equal(annualCharge("u1"), 120);
});

test("admin handler", () => {
	assert.equal(handleGetUser("u2").status, 200);
	assert.equal(handleGetUser("zz").status, 404);
});

test("batch", () => {
	assert.deepEqual(
		loadMany(["u1", "x", "u2"]).map((u) => u.id),
		["u1", "u2"],
	);
});
