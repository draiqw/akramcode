import type { SandboxRuntime } from "@akramcode/sandbox";
import { describe, expect, it } from "vitest";
import { sandboxToolsOptions } from "../src/core/sandbox-tools.ts";

function runtime(withFiles: boolean): SandboxRuntime {
	const files = withFiles
		? {
				readFile: async () => Buffer.from("x"),
				writeFile: async () => undefined,
				mkdir: async () => undefined,
				access: async () => undefined,
				exists: async () => true,
				stat: async () => ({ isDirectory: () => true }),
				readdir: async () => [],
				glob: async () => [],
			}
		: undefined;
	return {
		provider: "test",
		sandboxId: "box",
		workspace: withFiles ? "volume" : "mount",
		bash: { exec: async () => ({ exitCode: 0 }) },
		...(files ? { files } : {}),
		release: async () => undefined,
	};
}

describe("sandboxToolsOptions", () => {
	it("moves only bash into a mounted sandbox", () => {
		const options = sandboxToolsOptions(runtime(false));
		expect(options.bash?.operations).toBeDefined();
		expect(options.read).toBeUndefined();
		expect(options.write).toBeUndefined();
		expect(options.edit).toBeUndefined();
	});

	it("moves every file tool into a volume sandbox", () => {
		const options = sandboxToolsOptions(runtime(true));
		for (const tool of ["read", "write", "edit", "ls", "find", "grep"] as const) {
			expect(options[tool]?.operations).toBeDefined();
		}
	});

	it("detects images by extension", async () => {
		const detect = sandboxToolsOptions(runtime(true)).read?.operations?.detectImageMimeType;
		expect(await detect?.("/p/a.PNG")).toBe("image/png");
		expect(await detect?.("/p/a.txt")).toBeUndefined();
	});

	it("explains why grep is unavailable in a volume sandbox", () => {
		const grep = sandboxToolsOptions(runtime(true)).grep?.operations;
		expect(() => grep?.isDirectory("/p")).toThrow("through bash");
	});
});
