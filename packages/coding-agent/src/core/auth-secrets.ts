import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Encryption of literal secrets inside auth.json (AES-256-GCM).
 *
 * Protects copies of the file: backups, synced dotfiles, pasted logs. It does not protect against
 * someone who can read both auth.json and the key next to it, or the running user's process.
 * Plaintext entries stay readable and are encrypted the next time the file is written.
 */

export const SECRETS_KEY_ENV = "AKRAMCODE_SECRETS_KEY";
const PREFIX = "enc:v1:";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
/** auth.json: key/access/refresh. mcp-auth.json (nested): OAuth tokens, client secret, PKCE verifier. */
const SECRET_FIELDS = new Set([
	"key",
	"access",
	"refresh",
	"access_token",
	"refresh_token",
	"id_token",
	"client_secret",
	"codeVerifier",
]);
/** Every string inside these objects is a secret (provider environment such as cloud keys). */
const SECRET_MAPS = new Set(["env"]);

function parseKey(raw: string, source: string): Buffer {
	const text = raw.trim();
	const key = /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, "hex") : Buffer.from(text, "base64");
	if (key.length !== KEY_BYTES) throw new Error(`${source} must hold a ${KEY_BYTES}-byte key (base64 or hex).`);
	return key;
}

/** `$NAME` and `!command` values are references, not secrets: they stay readable in the file. */
function isReference(value: string): boolean {
	return value.startsWith("!") || /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(value);
}

export function keyFilePath(authPath: string): string {
	return join(dirname(authPath), "secrets.key");
}

function loadKey(authPath: string, create: boolean): Buffer | undefined {
	const fromEnv = process.env[SECRETS_KEY_ENV];
	if (fromEnv) return parseKey(fromEnv, SECRETS_KEY_ENV);
	const path = keyFilePath(authPath);
	if (existsSync(path)) return parseKey(readFileSync(path, "utf-8"), path);
	if (!create) return undefined;
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const key = randomBytes(KEY_BYTES);
	writeFileSync(path, `${key.toString("base64")}\n`, { encoding: "utf-8", mode: 0o600 });
	chmodSync(path, 0o600);
	return key;
}

export function encryptSecret(plain: string, key: Buffer): string {
	const nonce = randomBytes(NONCE_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key, nonce);
	const body = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
	return PREFIX + Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64url");
}

export function decryptSecret(value: string, key: Buffer): string {
	const raw = Buffer.from(value.slice(PREFIX.length), "base64url");
	if (raw.length < NONCE_BYTES + TAG_BYTES) throw new Error("Stored credential is truncated.");
	const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, NONCE_BYTES));
	decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
	return Buffer.concat([
		decipher.update(raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES)),
		decipher.final(),
	]).toString("utf-8");
}

type Json = Record<string, unknown>;

function mapSecrets(text: string, transform: (value: string) => string | undefined): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return text;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return text;
	let changed = false;
	const walk = (node: Json, allStrings: boolean): void => {
		for (const [field, value] of Object.entries(node)) {
			if (typeof value === "string") {
				if (!allStrings && !SECRET_FIELDS.has(field)) continue;
				const next = transform(value);
				if (next !== undefined && next !== value) {
					node[field] = next;
					changed = true;
				}
			} else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
				walk(value as Json, allStrings || SECRET_MAPS.has(field));
			}
		}
	};
	walk(parsed as Json, false);
	return changed ? JSON.stringify(parsed, null, 2) : text;
}

const warnedPaths = new Set<string>();

/** Credential reads swallow errors and fall back to "not logged in", so say why once per file. */
function warnUndecryptable(error: Error, authPath: string): never {
	if (!warnedPaths.has(authPath)) {
		warnedPaths.add(authPath);
		process.emitWarning(error.message, "AuthSecretsWarning");
	}
	throw error;
}

/** Text of auth.json as stored on disk -> text with every secret in the clear. */
export function decryptAuthText(text: string, authPath: string): string {
	if (!text.includes(PREFIX)) return text;
	const key = loadKey(authPath, false);
	return mapSecrets(text, (value) => {
		if (!value.startsWith(PREFIX)) return undefined;
		if (!key) {
			warnUndecryptable(
				new Error(
					`auth.json is encrypted but no key was found. Set ${SECRETS_KEY_ENV} or restore ${keyFilePath(authPath)}.`,
				),
				authPath,
			);
		}
		try {
			return decryptSecret(value, key);
		} catch {
			return warnUndecryptable(
				new Error(
					`auth.json could not be decrypted with the current key (${SECRETS_KEY_ENV} or ${keyFilePath(authPath)}). Restore the original key or log in again.`,
				),
				authPath,
			);
		}
	});
}

/** Text with secrets in the clear -> text to write to disk. */
export function encryptAuthText(text: string, authPath: string): string {
	let key: Buffer | undefined;
	return mapSecrets(text, (value) => {
		if (value === "" || value.startsWith(PREFIX) || isReference(value)) return undefined;
		key ??= loadKey(authPath, true);
		return key ? encryptSecret(value, key) : undefined;
	});
}
