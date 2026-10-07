import assert from "node:assert/strict";
import { test } from "node:test";
import { addBusinessDays, businessDaysBetween } from "../src/business-days.ts";

test("adds within a week", () => {
	// 2024-03-04 is a Monday
	const result = addBusinessDays(new Date("2024-03-04T09:00:00Z"), 2);
	assert.equal(result.toISOString(), "2024-03-06T09:00:00.000Z");
});

test("skips the weekend", () => {
	// Friday + 1 business day = Monday
	const result = addBusinessDays(new Date("2024-03-08T09:00:00Z"), 1);
	assert.equal(result.toISOString(), "2024-03-11T09:00:00.000Z");
});

test("counts between", () => {
	assert.equal(businessDaysBetween(new Date("2024-03-04T00:00:00Z"), new Date("2024-03-11T00:00:00Z")), 5);
});
