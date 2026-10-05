import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SECRETS_KEY_ENV } from "../src/core/auth-secrets.ts";
import { AuthStorage, readStoredCredential } from "../src/core/auth-storage.ts";

function tempAuth(): { dir: string; authPath: string } {
	const dir = mkdtempSync(join(tmpdir(), "akramcode-secrets-"));
	return { dir, authPath: join(dir, "auth.json") };
}

afterEach(() => vi.unstubAllEnvs());

describe("auth.json secret encryption", () => {
	it("stores api keys and OAuth tokens encrypted and reads them back in the clear", async () => {
		const { authPath } = tempAuth();
		const storage = AuthStorage.create(authPath);
		await storage.modify("openai", async () => ({ type: "api_key", key: "sk-secret-value" }));
		await storage.modify("openai-codex", async () => ({
			type: "oauth",
			access: "access-secret",
			refresh: "refresh-secret",
			expires: 123,
		}));

		const onDisk = readFileSync(authPath, "utf-8");
		expect(onDisk).not.toContain("sk-secret-value");
		expect(onDisk).not.toContain("access-secret");
		expect(onDisk).not.toContain("refresh-secret");
		expect(onDisk).toContain("enc:v1:");

		const fresh = AuthStorage.create(authPath);
		expect(await fresh.read("openai")).toEqual({ type: "api_key", key: "sk-secret-value" });
		expect(await fresh.read("openai-codex")).toMatchObject({ access: "access-secret", refresh: "refresh-secret" });
		expect(readStoredCredential("openai", authPath)).toEqual({ type: "api_key", key: "sk-secret-value" });
	});

	it("creates the key file with owner-only permissions", async () => {
		const { dir, authPath } = tempAuth();
		await AuthStorage.create(authPath).modify("openai", async () => ({ type: "api_key", key: "sk-x" }));
		const keyPath = join(dir, "secrets.key");
		expect(existsSync(keyPath)).toBe(true);
		expect(statSync(keyPath).mode & 0o777).toBe(0o600);
	});

	it("keeps environment references and commands readable", async () => {
		const { authPath } = tempAuth();
		const storage = AuthStorage.create(authPath);
		await storage.modify("openai", async () => ({ type: "api_key", key: "$OPENAI_API_KEY" }));
		await storage.modify("deepseek", async () => ({ type: "api_key", key: "!pass show deepseek" }));
		const onDisk = JSON.parse(readFileSync(authPath, "utf-8"));
		expect(onDisk.openai.key).toBe("$OPENAI_API_KEY");
		expect(onDisk.deepseek.key).toBe("!pass show deepseek");
	});

	it("reads legacy plaintext files and encrypts them on the next write", async () => {
		const { authPath } = tempAuth();
		writeFileSync(authPath, JSON.stringify({ openai: { type: "api_key", key: "sk-legacy" } }));
		const storage = AuthStorage.create(authPath);
		expect(await storage.read("openai")).toEqual({ type: "api_key", key: "sk-legacy" });

		await storage.modify("deepseek", async () => ({ type: "api_key", key: "sk-new" }));
		const onDisk = readFileSync(authPath, "utf-8");
		expect(onDisk).not.toContain("sk-legacy");
		expect(onDisk).not.toContain("sk-new");
		expect(await AuthStorage.create(authPath).read("openai")).toEqual({ type: "api_key", key: "sk-legacy" });
	});

	it("uses the key from the environment instead of a key file", async () => {
		const { dir, authPath } = tempAuth();
		vi.stubEnv(SECRETS_KEY_ENV, randomBytes(32).toString("base64"));
		await AuthStorage.create(authPath).modify("openai", async () => ({ type: "api_key", key: "sk-env-key" }));
		expect(existsSync(join(dir, "secrets.key"))).toBe(false);
		expect(await AuthStorage.create(authPath).read("openai")).toEqual({ type: "api_key", key: "sk-env-key" });
	});

	it("warns with a clear message when the key no longer matches", async () => {
		const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
		const { authPath } = tempAuth();
		vi.stubEnv(SECRETS_KEY_ENV, randomBytes(32).toString("base64"));
		await AuthStorage.create(authPath).modify("openai", async () => ({ type: "api_key", key: "sk-gone" }));
		vi.stubEnv(SECRETS_KEY_ENV, randomBytes(32).toString("base64"));
		expect(await AuthStorage.create(authPath).read("openai")).toBeUndefined();
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/could not be decrypted/), "AuthSecretsWarning");
		warn.mockRestore();
	});
});
