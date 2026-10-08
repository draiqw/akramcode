/**
 * Secret redaction for captured traces. Header names are kept and values of credential headers
 * replaced; URL query parameters and bodies are scanned for known key and token formats. Secret
 * values seen in credential headers are remembered and removed wherever they reappear.
 */

export const REDACTED = "[REDACTED]";

/** Headers whose values are always credentials. */
const SECRET_HEADER_NAMES = new Set([
	"authorization",
	"proxy-authorization",
	"cookie",
	"set-cookie",
	"x-api-key",
	"api-key",
	"x-goog-api-key",
	"x-auth-token",
	"x-access-token",
	"x-amz-security-token",
	"x-csrf-token",
	"chatgpt-account-id",
]);

/** Other header names that look like they carry a credential. */
const SECRET_HEADER_PATTERN = /(?:^|[-_])(?:key|token|secret|password|passwd|auth|session-token|signature)(?:$|[-_])/i;

/** Header names that match the pattern but carry no secret. */
const SAFE_HEADER_NAMES = new Set(["x-session-affinity", "openai-organization", "anthropic-version"]);

const SECRET_QUERY_PATTERN =
	/^(?:key|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|client[-_]?secret|code|code[-_]?verifier|password|sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token|auth)$/i;

/** Known credential formats. Each match is replaced with a placeholder that keeps a short prefix. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
	/\bsk-ant-[A-Za-z0-9_-]{16,}/g,
	/\bsk-(?:proj-|svcacct-|or-v1-)?[A-Za-z0-9_-]{20,}/g,
	/\bAIza[0-9A-Za-z_-]{30,}/g,
	/\bgh[pousr]_[A-Za-z0-9]{30,}/g,
	/\bgithub_pat_[A-Za-z0-9_]{30,}/g,
	/\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
	/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
	/\bglpat-[A-Za-z0-9_-]{20,}/g,
	/\bhf_[A-Za-z0-9]{30,}/g,
	/\bgsk_[A-Za-z0-9]{30,}/g,
	/\bxai-[A-Za-z0-9]{30,}/g,
	/\bnpm_[A-Za-z0-9]{30,}/g,
	// JWTs (OAuth access and id tokens).
	/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** JSON fields and form fields whose values are credentials. */
const SECRET_FIELD_JSON =
	/("(?:access_token|refresh_token|id_token|api_key|apiKey|client_secret|password|secret|token|authorization|code_verifier|private_key)"\s*:\s*)"(?:[^"\\]|\\.)*"/g;
const SECRET_FIELD_FORM =
	/(\b(?:access_token|refresh_token|id_token|client_secret|code_verifier|password|api_key)=)[^&\s"']+/g;
const BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g;

const MIN_LEARNED_SECRET_LENGTH = 12;
const MAX_LEARNED_SECRETS = 256;

export class Redactor {
	private readonly learned = new Set<string>();

	/** Remember a secret value so later bodies containing it are redacted. */
	learn(value: string | undefined): void {
		if (!value) return;
		const trimmed = value.replace(/^(?:Bearer|Basic|Token)\s+/i, "").trim();
		if (trimmed.length < MIN_LEARNED_SECRET_LENGTH || this.learned.has(trimmed)) return;
		if (this.learned.size >= MAX_LEARNED_SECRETS) {
			const oldest = this.learned.values().next().value;
			if (oldest !== undefined) this.learned.delete(oldest);
		}
		this.learned.add(trimmed);
	}

	isSecretHeader(name: string): boolean {
		const lower = name.toLowerCase();
		if (SAFE_HEADER_NAMES.has(lower)) return false;
		return SECRET_HEADER_NAMES.has(lower) || SECRET_HEADER_PATTERN.test(lower);
	}

	/** Redact header values; names are kept. Secret values are learned for body redaction. */
	headers(headers: Record<string, string | string[]>): Record<string, string | string[]> {
		const result: Record<string, string | string[]> = {};
		for (const [name, value] of Object.entries(headers)) {
			if (this.isSecretHeader(name)) {
				const values = Array.isArray(value) ? value : [value];
				for (const item of values) this.learn(item);
				result[name] = Array.isArray(value) ? value.map((item) => this.headerValue(item)) : this.headerValue(value);
			} else {
				result[name] = Array.isArray(value) ? value.map((item) => this.text(item)) : this.text(value);
			}
		}
		return result;
	}

	private headerValue(value: string): string {
		const scheme = /^(Bearer|Basic|Token)\s+/i.exec(value)?.[1];
		return `${scheme ? `${scheme} ` : ""}${REDACTED} (${value.length} chars)`;
	}

	url(raw: string): string {
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			return this.text(raw);
		}
		if (url.username) url.username = REDACTED;
		if (url.password) url.password = REDACTED;
		for (const key of [...url.searchParams.keys()]) {
			if (SECRET_QUERY_PATTERN.test(key)) url.searchParams.set(key, REDACTED);
		}
		return this.text(url.toString());
	}

	/** Redact known secret formats, credential fields, and learned secrets in free text. */
	text(input: string): string {
		if (!input) return input;
		let output = input;
		for (const secret of this.learned) {
			if (output.includes(secret)) output = output.split(secret).join(REDACTED);
		}
		output = output.replace(BEARER_PATTERN, (_match, scheme: string) => `${scheme} ${REDACTED}`);
		for (const pattern of SECRET_VALUE_PATTERNS) {
			output = output.replace(pattern, (match) => `${match.slice(0, Math.min(6, match.length))}…${REDACTED}`);
		}
		output = output.replace(SECRET_FIELD_JSON, (_match, prefix: string) => `${prefix}"${REDACTED}"`);
		output = output.replace(SECRET_FIELD_FORM, (_match, prefix: string) => `${prefix}${REDACTED}`);
		return output;
	}
}
