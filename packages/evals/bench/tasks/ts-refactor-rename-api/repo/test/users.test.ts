import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchUserData, UserNotFoundError, userExists } from "../src/api/users.ts";

test("fetchUserData normalizes ids", () => {
	assert.equal(fetchUserData("  U1 ").name, "Ada Lovelace");
});

test("fetchUserData throws for unknown users", () => {
	assert.throws(() => fetchUserData("nope"), UserNotFoundError);
});

test("userExists", () => {
	assert.equal(userExists("u2"), true);
	assert.equal(userExists("u9"), false);
});
