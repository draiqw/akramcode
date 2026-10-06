import { describe, expect, it } from "vitest";
import { resolveSandboxSettings } from "../src/settings.ts";
import { shellQuote, withForwardedEnv } from "../src/shell.ts";

describe("resolveSandboxSettings", () => {
	it("defaults to the local machine and a mounted workspace", () => {
		const resolved = resolveSandboxSettings(undefined);
		expect(resolved.provider).toBe("local");
		expect(resolved.workspace).toBe("mount");
		expect(resolved.opensandbox.domain).toBe("127.0.0.1:8080");
		expect(resolved.opensandbox.ttlMinutes).toBe(330);
	});

	it("keeps valid values and ignores invalid ones", () => {
		const resolved = resolveSandboxSettings({
			provider: "opensandbox",
			workspace: "volume",
			opensandbox: { domain: " box:9 ", ttlMinutes: -1, maxLive: 3.7, network: "deny", apiKey: "" },
		});
		expect(resolved.provider).toBe("opensandbox");
		expect(resolved.workspace).toBe("volume");
		expect(resolved.opensandbox.domain).toBe("box:9");
		expect(resolved.opensandbox.ttlMinutes).toBe(330);
		expect(resolved.opensandbox.maxLive).toBe(3);
		expect(resolved.opensandbox.network).toBe("deny");
		expect(resolved.opensandbox.apiKey).toBeUndefined();
	});
});

describe("shell helpers", () => {
	it("quotes single quotes", () => {
		expect(shellQuote("it's")).toBe(`'it'\\''s'`);
	});

	it("forwards only the documented session variables", () => {
		const script = withForwardedEnv("ls", {
			PATH: "/bin",
			AKRAMCODE_SESSION_ID: "a b",
			AKRAMCODE_X: undefined,
			"BAD NAME": "x",
		});
		expect(script).toBe("export AKRAMCODE_SESSION_ID='a b'\nls");
		expect(withForwardedEnv("ls", { PATH: "/bin" })).toBe("ls");
	});
});
