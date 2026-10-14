import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkForNewAkramCodeVersion,
	comparePackageVersions,
	formatVersionCheckError,
	getLatestAkramCodeRelease,
	getLatestAkramCodeVersion,
	isNewerPackageVersion,
} from "../src/utils/version-check.ts";
import { allowNetwork } from "./test-network-env.ts";

const originalSkipVersionCheck = process.env.AKRAMCODE_SKIP_VERSION_CHECK;

beforeEach(() => {
	allowNetwork();
	vi.stubEnv("AKRAMCODE_VERSION_CHECK_URL", "https://updates.example.test/api/latest-version");
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	if (originalSkipVersionCheck === undefined) {
		delete process.env.AKRAMCODE_SKIP_VERSION_CHECK;
	} else {
		process.env.AKRAMCODE_SKIP_VERSION_CHECK = originalSkipVersionCheck;
	}
});

describe("version checks", () => {
	it("reads the latest GitHub release when no version check URL is configured", async () => {
		vi.stubEnv("AKRAMCODE_VERSION_CHECK_URL", "");
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "v1.2.4", name: "v1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestAkramCodeRelease("1.2.3")).resolves.toEqual({ version: "1.2.4" });
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.github.com/repos/draiqw/akramcode/releases/latest",
			expect.objectContaining({
				headers: expect.objectContaining({
					"User-Agent": expect.stringMatching(/^akramcode\/1\.2\.3 /),
					accept: "application/vnd.github+json",
				}),
			}),
		);
	});

	it("ignores GitHub release responses without a tag", async () => {
		vi.stubEnv("AKRAMCODE_VERSION_CHECK_URL", "");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ message: "Not Found" }, { status: 404 })),
		);
		await expect(getLatestAkramCodeRelease("1.2.3")).resolves.toBeUndefined();

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ name: "draft" })),
		);
		await expect(getLatestAkramCodeRelease("1.2.3")).resolves.toBeUndefined();
	});

	it("makes no request in offline mode", async () => {
		vi.stubEnv("AKRAMCODE_VERSION_CHECK_URL", "");
		vi.stubEnv("AKRAMCODE_OFFLINE", "1");
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(getLatestAkramCodeRelease("1.2.3")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("compares package versions", () => {
		expect(comparePackageVersions("0.70.6", "0.70.5")).toBeGreaterThan(0);
		expect(comparePackageVersions("0.70.5", "0.70.5")).toBe(0);
		expect(comparePackageVersions("0.70.4", "0.70.5")).toBeLessThan(0);
		expect(comparePackageVersions("5.0.0-beta.20", "5.0.0-beta.9")).toBeGreaterThan(0);
		expect(isNewerPackageVersion("0.70.5", "0.70.5")).toBe(false);
		expect(isNewerPackageVersion("0.70.6", "0.70.5")).toBe(true);
	});

	it("returns only newer versions", async () => {
		const fetchMock = vi.fn(async () => Response.json({ version: "1.2.3" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewAkramCodeVersion("1.2.3")).resolves.toBeUndefined();
		await expect(checkForNewAkramCodeVersion("1.2.2")).resolves.toEqual({ version: "1.2.3" });
	});

	it("uses the configured version check api with a akramcode user agent", async () => {
		const fetchMock = vi.fn(async () => Response.json({ version: "1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestAkramCodeVersion("1.2.3")).resolves.toBe("1.2.4");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://updates.example.test/api/latest-version",
			expect.objectContaining({
				headers: expect.objectContaining({
					"User-Agent": expect.stringMatching(/^akramcode\/1\.2\.3 /),
					accept: "application/json",
				}),
			}),
		);
	});

	it("retries a transient version request when explicitly requested", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error("fetch failed"))
			.mockRejectedValueOnce(new Error("fetch failed"))
			.mockResolvedValueOnce(Response.json({ version: "1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestAkramCodeRelease("1.2.3", { retry: true })).resolves.toEqual({ version: "1.2.4" });
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("keeps automatic version checks to one request", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewAkramCodeVersion("1.2.3")).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("formats nested network error details", () => {
		const error = new Error("fetch failed", {
			cause: new AggregateError([
				Object.assign(new Error("connect timeout"), { code: "ETIMEDOUT" }),
				Object.assign(new Error("network unreachable"), { code: "ENETUNREACH" }),
			]),
		});

		expect(formatVersionCheckError(error)).toBe("fetch failed (ETIMEDOUT, ENETUNREACH)");
	});

	it("returns the active package metadata from the version check api", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				packageName: "@new-scope/akramcode",
				version: "1.2.4",
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestAkramCodeRelease("1.2.3")).resolves.toEqual({
			packageName: "@new-scope/akramcode",
			version: "1.2.4",
		});
	});

	it("returns update notes from the version check api", async () => {
		const fetchMock = vi.fn(async () => Response.json({ note: " **Read this** ", version: "1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestAkramCodeRelease("1.2.3")).resolves.toEqual({ note: "**Read this**", version: "1.2.4" });
	});

	it("skips automatic api calls when version checks are disabled", async () => {
		process.env.AKRAMCODE_SKIP_VERSION_CHECK = "1";
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewAkramCodeVersion("1.2.3")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("allows direct api calls when automatic version checks are disabled", async () => {
		process.env.AKRAMCODE_SKIP_VERSION_CHECK = "1";
		const fetchMock = vi.fn(async () => Response.json({ version: "1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestAkramCodeVersion("1.2.3")).resolves.toBe("1.2.4");
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
