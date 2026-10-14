import { posix } from "node:path";
import { createSandboxBashOperations, type SessionHost } from "./exec.ts";
import { matchesGlob } from "./glob.ts";
import { shellQuote } from "./shell.ts";
import type { SandboxFileOperations } from "./types.ts";

function notFound(path: string): Error {
	return Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: "ENOENT" });
}

/** File access through the sandbox file API, with `find` over the shell session for glob. */
export function createSandboxFileOperations(host: SessionHost): SandboxFileOperations {
	const files = host.sandbox.files;
	const bash = createSandboxBashOperations(host);

	async function info(path: string) {
		let entries: Record<string, { type?: string } | undefined>;
		try {
			entries = await files.getFileInfo([path]);
		} catch {
			throw notFound(path);
		}
		const entry = entries[path] ?? Object.values(entries)[0];
		if (!entry) throw notFound(path);
		return entry;
	}

	return {
		async readFile(path) {
			await info(path);
			return Buffer.from(await files.readBytes(path));
		},
		async writeFile(path, content) {
			await files.createDirectories([{ path: posix.dirname(path) }]);
			await files.writeFiles([{ path, data: content, mode: 0o644 }]);
		},
		async mkdir(path) {
			await files.createDirectories([{ path }]);
		},
		async access(path) {
			await info(path);
		},
		async exists(path) {
			try {
				await info(path);
				return true;
			} catch {
				return false;
			}
		},
		async stat(path) {
			const entry = await info(path);
			return { isDirectory: () => entry.type === "directory" };
		},
		async readdir(path) {
			const entries = await files.listDirectory({ path, depth: 1 });
			return entries.map((entry) => posix.basename(entry.path)).sort();
		},
		async glob(pattern, cwd, { ignore, limit }) {
			let output = "";
			const result = await bash.exec(`cd ${shellQuote(cwd)} && find . -type f | head -n 200000`, cwd, {
				onData: (data) => {
					output += data.toString();
				},
			});
			if (result.exitCode !== 0) return [];
			const matches: string[] = [];
			for (const line of output.split("\n")) {
				const relative = line.startsWith("./") ? line.slice(2) : line;
				if (relative === "" || ignore.some((glob) => matchesGlob(glob, relative))) continue;
				if (matchesGlob(pattern, relative)) matches.push(relative);
				if (matches.length >= limit) break;
			}
			return matches;
		},
	};
}
