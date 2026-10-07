/**
 * Arm definitions and per-run settings.
 *
 * An arm is a build plus a settings overlay. Builds:
 * - `release:<tag>`: GitHub release tarball, downloaded with `gh` and cached
 * - `binary:<path>`: an akramcode executable
 * - `source:<dir>`: a source checkout run through Node type stripping
 * - `ref:<git ref>`: a detached worktree of the current repository at that ref, run as source
 *
 * Settings written to the isolated agent dir are the deep merge of the arm settings and the task
 * variant settings, with macros resolved. Macro `$compactAtTokens: N` sets
 * `compaction.reserveTokens = contextWindow - N`, so threshold compaction fires once the context
 * exceeds N tokens regardless of the model's window.
 */

import type { SettingsObject } from "./tasks.ts";

export type BuildSpec =
	| { kind: "release"; tag: string }
	| { kind: "binary"; path: string }
	| { kind: "source"; dir: string }
	| { kind: "ref"; ref: string };

export interface ArmSpec {
	name: string;
	build: BuildSpec;
	settings: SettingsObject;
	/** Original build text, for reports. */
	buildText: string;
}

export function parseBuildSpec(text: string): BuildSpec {
	const colon = text.indexOf(":");
	const kind = colon === -1 ? "" : text.slice(0, colon);
	const value = colon === -1 ? "" : text.slice(colon + 1);
	if (!value)
		throw new Error(`Invalid build "${text}". Use release:<tag>, binary:<path>, source:<dir>, or ref:<ref>.`);
	switch (kind) {
		case "release":
			return { kind, tag: value };
		case "binary":
			return { kind, path: value };
		case "source":
			return { kind, dir: value };
		case "ref":
			return { kind, ref: value };
		default:
			throw new Error(`Unknown build kind "${kind}" in "${text}".`);
	}
}

/** Parses `name=value` CLI pairs. */
export function parseNamedValue(text: string, option: string): { name: string; value: string } {
	const equals = text.indexOf("=");
	const name = equals === -1 ? "" : text.slice(0, equals).trim();
	const value = equals === -1 ? "" : text.slice(equals + 1).trim();
	if (!/^[A-Za-z0-9_-]+$/.test(name) || !value) throw new Error(`${option} expects <arm>=<value>, got "${text}"`);
	return { name, value };
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep merge of plain objects. Arrays and scalars from `overlay` replace those in `base`. */
export function mergeSettings(base: SettingsObject, overlay: SettingsObject): SettingsObject {
	const result: SettingsObject = { ...base };
	for (const [key, value] of Object.entries(overlay)) {
		const existing = result[key];
		result[key] = isObject(existing) && isObject(value) ? mergeSettings(existing, value) : value;
	}
	return result;
}

/** Resolves harness macros (keys starting with `$`) into real settings. */
export function resolveSettingsMacros(settings: SettingsObject, contextWindow: number): SettingsObject {
	const { $compactAtTokens, ...rest } = settings;
	for (const key of Object.keys(rest)) {
		if (key.startsWith("$")) throw new Error(`Unknown settings macro ${key}`);
	}
	if ($compactAtTokens === undefined) return rest;
	if (typeof $compactAtTokens !== "number" || !Number.isSafeInteger($compactAtTokens) || $compactAtTokens <= 0) {
		throw new Error("$compactAtTokens must be a positive integer");
	}
	if ($compactAtTokens >= contextWindow) {
		throw new Error(`$compactAtTokens (${$compactAtTokens}) must be below the context window (${contextWindow})`);
	}
	return mergeSettings(rest, { compaction: { reserveTokens: contextWindow - $compactAtTokens } });
}

export function settingsForRun(arm: SettingsObject, variant: SettingsObject, contextWindow: number): SettingsObject {
	return resolveSettingsMacros(mergeSettings(arm, variant), contextWindow);
}
