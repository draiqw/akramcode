import { describe, expect, it } from "vitest";
import { getAkramCodeUserAgent } from "../src/utils/akramcode-user-agent.ts";

describe("getAkramCodeUserAgent", () => {
	it("formats the user agent expected by the catalog server", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getAkramCodeUserAgent("1.2.3");

		expect(userAgent).toBe(`akramcode/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^akramcode\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
