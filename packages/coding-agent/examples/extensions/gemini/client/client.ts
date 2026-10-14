// Adapted from pi-antigravity v0.10.0, commit d59d22b. MIT; see ../LICENSE.
import { createHash } from "node:crypto";
import type { AntigravityApiKey, AvailableModelsRaw } from "../types/types.ts";
import { antigravityFetch } from "../utils/http.ts";
import { assertSafeApiBaseUrl, safeError } from "../utils/security.ts";
import { antigravityEnv, isRecord } from "../utils/util.ts";

export const DEFAULT_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
export const ENDPOINT_FALLBACKS = [
	DEFAULT_ENDPOINT,
	"https://daily-cloudcode-pa.sandbox.googleapis.com",
	"https://cloudcode-pa.googleapis.com",
];
export function endpointCandidates(): string[] {
	const explicit = antigravityEnv("BASE_URL")?.trim();
	return explicit ? [assertSafeApiBaseUrl(explicit)] : ENDPOINT_FALLBACKS;
}
export function antigravityHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
		"User-Agent":
			"antigravity/cli/1.2.4 (aidev_client; os_type=linux; arch=amd64; cl=982146307; auth_method=consumer)",
	};
}
export function defaultProjectId(seed = "gemini-default"): string {
	const explicit = antigravityEnv("PROJECT_ID")?.trim();
	if (explicit) return explicit;
	const bytes = createHash("sha1").update(`antigravity:${seed}`).digest().subarray(0, 16);
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function parseApiKey(raw: string | undefined): AntigravityApiKey {
	if (!raw) throw new Error("No Gemini subscription credentials. Run /login gemini.");
	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			!isRecord(parsed) ||
			typeof parsed.token !== "string" ||
			!parsed.token ||
			typeof parsed.projectId !== "string" ||
			!parsed.projectId
		)
			throw new Error("missing token or projectId");
		return { token: parsed.token, projectId: parsed.projectId };
	} catch {
		throw new Error("Invalid Gemini subscription credentials. Run /login gemini.");
	}
}
export function jsonOrTextError(text: string): string {
	try {
		const data: unknown = JSON.parse(text);
		if (isRecord(data) && isRecord(data.error) && typeof data.error.message === "string") return data.error.message;
	} catch {
		/* Plain-text backend response. */
	}
	return text;
}
export function extractProjectId(data: unknown): string | undefined {
	if (!isRecord(data)) return undefined;
	for (const key of [
		"antigravityProjectId",
		"projectId",
		"backendProjectId",
		"userDefinedCloudaicompanionProject",
		"cloudaicompanionProject",
		"project",
	]) {
		const value = data[key];
		if (typeof value === "string" && value) return value;
		if (isRecord(value) && typeof value.id === "string" && value.id) return value.id;
	}
	for (const key of ["projects", "projectIds", "cloudaicompanionProjects"]) {
		const entries = data[key];
		if (Array.isArray(entries))
			for (const entry of entries) {
				const project = typeof entry === "string" ? entry : extractProjectId(entry);
				if (project) return project;
			}
	}
	return undefined;
}
function discoverySignal(signal?: AbortSignal): AbortSignal {
	return signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
}
export async function loadCodeAssist(token: string, signal?: AbortSignal): Promise<string | undefined> {
	for (const endpoint of endpointCandidates()) {
		signal?.throwIfAborted();
		try {
			const response = await antigravityFetch(`${endpoint}/v1internal:loadCodeAssist`, {
				method: "POST",
				headers: antigravityHeaders(token),
				body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
				signal: discoverySignal(signal),
			});
			if (!response.ok) {
				await response.body?.cancel();
				continue;
			}
			const project = extractProjectId(await response.json());
			if (project) return project;
			const listed = await antigravityFetch(`${endpoint}/v1internal:listCloudAICompanionProjects`, {
				method: "POST",
				headers: antigravityHeaders(token),
				body: "{}",
				signal: discoverySignal(signal),
			});
			if (listed.ok) {
				const found = extractProjectId(await listed.json());
				if (found) return found;
			} else await listed.body?.cancel();
		} catch {
			signal?.throwIfAborted();
		}
	}
	return undefined;
}
export async function fetchAvailableModelsCatalog(
	token: string,
	projectId: string,
	signal?: AbortSignal,
): Promise<{ data: AvailableModelsRaw }> {
	const models: NonNullable<AvailableModelsRaw["models"]> = {};
	let success = false;
	let lastError = "No catalog endpoint available";
	for (const endpoint of endpointCandidates()) {
		signal?.throwIfAborted();
		try {
			const response = await antigravityFetch(`${endpoint}/v1internal:fetchAvailableModels`, {
				method: "POST",
				headers: antigravityHeaders(token),
				body: JSON.stringify({ project: projectId }),
				signal: discoverySignal(signal),
			});
			if (!response.ok) {
				lastError = `Catalog request failed (${response.status})`;
				await response.body?.cancel();
				continue;
			}
			const data: unknown = await response.json();
			if (!isRecord(data) || !isRecord(data.models)) {
				lastError = "Invalid catalog response";
				continue;
			}
			for (const [id, info] of Object.entries(data.models)) if (isRecord(info)) models[id] = info;
			success = true;
		} catch (error) {
			signal?.throwIfAborted();
			lastError = safeError(error);
		}
	}
	signal?.throwIfAborted();
	if (!success) throw new Error(lastError);
	return { data: { models } };
}
