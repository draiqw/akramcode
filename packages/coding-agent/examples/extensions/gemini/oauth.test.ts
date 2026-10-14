import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getApiKey, parsePastedCallback, refreshAntigravityToken } from "./auth/oauth.ts";

const fetch = vi.fn();
beforeEach(() => {
	vi.stubGlobal("fetch", fetch);
});

afterEach(() => {
	fetch.mockReset();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

// Regression coverage for draiqw/akramcode#5: subscription credentials survive refresh.
describe("Gemini OAuth", () => {
	it("accepts callback URLs and query strings only for the current login state", () => {
		expect(
			parsePastedCallback("http://localhost:51121/oauth-callback?code=mock-code&state=current", "current"),
		).toEqual({ code: "mock-code", state: "current" });
		expect(parsePastedCallback("?code=mock-code&state=current", "current").code).toBe("mock-code");
		expect(() => parsePastedCallback("code=mock-code&state=other", "current")).toThrow(/state mismatch/i);
		expect(() => parsePastedCallback("code=mock-code", "current")).toThrow(/missing/i);
		expect(() => parsePastedCallback("error=access_denied&state=current", "current")).toThrow(/access_denied/i);
	});

	it("refreshes once and retains project, email, and metadata when Google omits a refresh token", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
		fetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new-mock-access", expires_in: 3600 })));
		const credentials = {
			access: "old-mock-access",
			refresh: "mock-refresh",
			expires: 0,
			projectId: "existing-project",
			email: "test@example.invalid",
			metadata: "preserve",
		};
		const refreshed = await refreshAntigravityToken(credentials);
		expect(fetch).toHaveBeenCalledOnce();
		expect(refreshed).toMatchObject({ ...credentials, access: "new-mock-access", expires: Date.now() + 3300000 });
		expect(JSON.parse(getApiKey(refreshed))).toEqual({ token: "new-mock-access", projectId: "existing-project" });
		const init = fetch.mock.calls[0]?.[1] as RequestInit;
		expect(new URLSearchParams(String(init.body)).get("grant_type")).toBe("refresh_token");
	});

	it("uses a rotated refresh token", async () => {
		fetch.mockResolvedValueOnce(
			new Response(
				JSON.stringify({ access_token: "mock-access", refresh_token: "rotated-mock-refresh", expires_in: 3600 }),
			),
		);
		const result = await refreshAntigravityToken({
			access: "old",
			refresh: "old-refresh",
			expires: 0,
			projectId: "existing-project",
		});
		expect(result.refresh).toBe("rotated-mock-refresh");
	});

	it("does not exchange credentials after cancellation", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			refreshAntigravityToken({ access: "old", refresh: "mock-refresh", expires: 0 }, controller.signal),
		).rejects.toThrow();
		expect(fetch).not.toHaveBeenCalled();
	});
});
