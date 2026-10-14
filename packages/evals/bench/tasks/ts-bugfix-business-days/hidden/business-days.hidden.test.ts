import assert from "node:assert/strict";
import { test } from "node:test";
import { addBusinessDays, businessDaysBetween, isBusinessDay } from "../src/business-days.ts";
import { dueDate } from "../src/sla.ts";

process.env.TZ = "Pacific/Kiritimati";

const iso = (d: Date) => d.toISOString();

test("isBusinessDay uses UTC", () => {
	assert.equal(isBusinessDay(new Date("2024-03-08T20:00:00Z")), true);
	assert.equal(isBusinessDay(new Date("2024-03-09T01:00:00Z")), false);
	assert.equal(isBusinessDay(new Date("2024-03-10T23:30:00Z")), false);
	assert.equal(isBusinessDay(new Date("2024-03-11T00:00:00Z")), true);
	assert.equal(isBusinessDay(new Date("2024-03-12T12:00:00Z"), ["2024-03-12"]), false);
});

test("forward over weekend preserves time", () => {
	assert.equal(iso(addBusinessDays(new Date("2024-03-08T20:00:00Z"), 1)), "2024-03-11T20:00:00.000Z");
	assert.equal(iso(addBusinessDays(new Date("2024-03-07T23:59:00Z"), 3)), "2024-03-12T23:59:00.000Z");
});

test("starting on a weekend", () => {
	assert.equal(iso(addBusinessDays(new Date("2024-03-09T10:00:00Z"), 1)), "2024-03-11T10:00:00.000Z");
});

test("holidays are skipped", () => {
	const holidays = ["2024-03-11", "2024-03-12"];
	assert.equal(iso(addBusinessDays(new Date("2024-03-08T09:00:00Z"), 1, holidays)), "2024-03-13T09:00:00.000Z");
});

test("negative offsets move backward", () => {
	assert.equal(iso(addBusinessDays(new Date("2024-03-11T09:00:00Z"), -1)), "2024-03-08T09:00:00.000Z");
	assert.equal(iso(addBusinessDays(new Date("2024-03-13T09:00:00Z"), -3, ["2024-03-11"])), "2024-03-07T09:00:00.000Z");
});

test("zero returns an unchanged copy", () => {
	const saturday = new Date("2024-03-09T10:00:00Z");
	const result = addBusinessDays(saturday, 0);
	assert.equal(iso(result), iso(saturday));
	assert.notEqual(result, saturday);
});

test("input is not mutated", () => {
	const start = new Date("2024-03-08T20:00:00Z");
	addBusinessDays(start, 5);
	assert.equal(iso(start), "2024-03-08T20:00:00.000Z");
});

test("non-integer n throws RangeError", () => {
	assert.throws(() => addBusinessDays(new Date("2024-03-08T00:00:00Z"), 1.5), RangeError);
	assert.throws(() => addBusinessDays(new Date("2024-03-08T00:00:00Z"), Number.NaN), RangeError);
});

test("year boundary", () => {
	assert.equal(iso(addBusinessDays(new Date("2024-12-31T12:00:00Z"), 1, ["2025-01-01"])), "2025-01-02T12:00:00.000Z");
});

test("between ignores time of day", () => {
	assert.equal(businessDaysBetween(new Date("2024-03-04T23:00:00Z"), new Date("2024-03-11T01:00:00Z")), 5);
	assert.equal(businessDaysBetween(new Date("2024-03-08T20:00:00Z"), new Date("2024-03-11T05:00:00Z")), 1);
	assert.equal(businessDaysBetween(new Date("2024-03-04T10:00:00Z"), new Date("2024-03-04T18:00:00Z")), 0);
});

test("between with holidays", () => {
	assert.equal(
		businessDaysBetween(new Date("2024-03-04T00:00:00Z"), new Date("2024-03-15T00:00:00Z"), ["2024-03-06", "2024-03-09"]),
		8,
	);
});

test("between reversed is negative", () => {
	assert.equal(businessDaysBetween(new Date("2024-03-11T00:00:00Z"), new Date("2024-03-04T00:00:00Z")), -5);
});

test("sla due date", () => {
	const due = dueDate({ id: "T1", openedAt: new Date("2024-03-08T20:00:00Z"), priority: "normal" }, ["2024-03-13"]);
	assert.equal(iso(due), "2024-03-18T20:00:00.000Z");
});
