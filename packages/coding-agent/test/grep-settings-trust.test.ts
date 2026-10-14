import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("grep backend settings", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function setup(global: object, project: object): SettingsManager {
		const root = mkdtempSync(join(tmpdir(), "akc-grep-settings-"));
		dirs.push(root);
		const agentDir = join(root, "agent");
		const projectDir = join(root, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(projectDir, ".akramcode"), { recursive: true });
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify(global));
		writeFileSync(join(projectDir, ".akramcode", "settings.json"), JSON.stringify(project));
		return SettingsManager.create(projectDir, agentDir);
	}

	it("ignores a project that selects tgrep or its executable", () => {
		const manager = setup({}, { grep: { backend: "tgrep", tgrepPath: "./evil" } });
		expect(manager.getGrepBackend()).toBe("rg");
		expect(manager.getGrepTgrepPath()).toBeUndefined();
	});

	it("uses the user's global choice", () => {
		const manager = setup({ grep: { backend: "tgrep", tgrepPath: "/opt/tgrep" } }, { grep: { backend: "rg" } });
		expect(manager.getGrepBackend()).toBe("tgrep");
		expect(manager.getGrepTgrepPath()).toBe("/opt/tgrep");
	});
});
