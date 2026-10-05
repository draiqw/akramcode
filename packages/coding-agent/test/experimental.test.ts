import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalAkramCodeExperimental = process.env.AKRAMCODE_EXPERIMENTAL;

	afterEach(() => {
		if (originalAkramCodeExperimental === undefined) {
			delete process.env.AKRAMCODE_EXPERIMENTAL;
		} else {
			process.env.AKRAMCODE_EXPERIMENTAL = originalAkramCodeExperimental;
		}
	});

	it("returns false when AKRAMCODE_EXPERIMENTAL is unset", () => {
		delete process.env.AKRAMCODE_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when AKRAMCODE_EXPERIMENTAL is empty", () => {
		process.env.AKRAMCODE_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when AKRAMCODE_EXPERIMENTAL is set to 1", () => {
		process.env.AKRAMCODE_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when AKRAMCODE_EXPERIMENTAL is set to 0", () => {
		process.env.AKRAMCODE_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when AKRAMCODE_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.AKRAMCODE_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});
