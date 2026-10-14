import { describe, expect, it } from "vitest";
import { globToRegExp, matchesGlob } from "../src/glob.ts";

describe("glob", () => {
	it("matches a bare file name at any depth", () => {
		expect(matchesGlob("*.ts", "a.ts")).toBe(true);
		expect(matchesGlob("*.ts", "src/deep/a.ts")).toBe(true);
		expect(matchesGlob("*.ts", "src/a.js")).toBe(false);
	});

	it("anchors patterns that contain a slash", () => {
		expect(matchesGlob("src/*.ts", "src/a.ts")).toBe(true);
		expect(matchesGlob("src/*.ts", "src/deep/a.ts")).toBe(false);
		expect(matchesGlob("src/**/*.ts", "src/deep/er/a.ts")).toBe(true);
		expect(matchesGlob("src/**/*.ts", "src/a.ts")).toBe(true);
	});

	it("supports braces, question marks and classes", () => {
		expect(globToRegExp("*.{ts,js}").test("a.js")).toBe(true);
		expect(globToRegExp("a?c").test("abc")).toBe(true);
		expect(globToRegExp("a?c").test("a/c")).toBe(false);
		expect(globToRegExp("[ab].txt").test("b.txt")).toBe(true);
	});

	it("escapes regular expression characters", () => {
		expect(globToRegExp("a.b").test("axb")).toBe(false);
		expect(globToRegExp("a+b").test("a+b")).toBe(true);
	});
});
