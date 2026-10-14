import assert from "node:assert/strict";
import { test } from "node:test";
import { addBusinessDays, isBusinessDay } from "../src/business-days.ts";

// Simulate a user in UTC+14. Results must not depend on the local time zone.
process.env.TZ = "Pacific/Kiritimati";

test("friday evening UTC is still friday", () => {
	const fridayEvening = new Date("2024-03-08T20:00:00Z");
	assert.equal(isBusinessDay(fridayEvening), true);
	assert.equal(addBusinessDays(fridayEvening, 1).toISOString(), "2024-03-11T20:00:00.000Z");
});
