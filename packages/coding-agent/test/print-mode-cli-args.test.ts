import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";

const cliPath = resolve(__dirname, "../src/cli.ts");
// --import takes a module specifier, not a filesystem path.
const sourceResolverUrl = pathToFileURL(resolve(__dirname, "../src/experimental/source-resolver.ts")).href;
const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

/** Run the CLI from source with stdin at end of file and no credentials. */
async function runCli(args: string[]): Promise<{ code: number | null; stderr: string }> {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "akramcode-print-args-")));
	tempDirs.push(root);
	const agentDir = join(root, "agent");
	const projectDir = join(root, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(projectDir, { recursive: true });
	let stderr = "";
	const code = await new Promise<number | null>((resolvePromise, reject) => {
		const child = spawn(process.execPath, ["--import", sourceResolverUrl, cliPath, ...args], {
			cwd: projectDir,
			env: { ...process.env, [ENV_AGENT_DIR]: agentDir, AKRAMCODE_OFFLINE: "1", NO_COLOR: "1" },
			stdio: ["ignore", "ignore", "pipe"],
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", resolvePromise);
	});
	return { code, stderr };
}

describe("print mode arguments", () => {
	it("fails with an error when --print gets no prompt", async () => {
		const result = await runCli(["-p"]);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("No prompt given");
	});

	it("warns about unknown --tools names instead of silently dropping all tools", async () => {
		const result = await runCli(["--tools", "read,nosuchtool", "-p", "hi"]);
		expect(result.stderr).toContain("Unknown tool name(s) in --tools, ignored: nosuchtool");
		expect(result.stderr).not.toMatch(/ignored: [^\n]*\bread\b/);
	});
});
