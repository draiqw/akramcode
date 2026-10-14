import type { SandboxRuntime } from "@akramcode/sandbox";
import type { ToolsOptions } from "./tools/index.ts";

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
};

/** The tool options that run the built-in tools inside the sandbox. */
export function sandboxToolsOptions(runtime: SandboxRuntime): ToolsOptions {
	const options: ToolsOptions = { bash: { operations: runtime.bash } };
	const files = runtime.files;
	if (!files) return options;
	return {
		...options,
		read: {
			operations: {
				readFile: (path) => files.readFile(path),
				access: (path) => files.access(path),
				detectImageMimeType: async (path) => {
					const dot = path.lastIndexOf(".");
					return dot === -1 ? undefined : IMAGE_MIME_BY_EXTENSION[path.slice(dot).toLowerCase()];
				},
			},
		},
		write: {
			operations: { writeFile: (path, content) => files.writeFile(path, content), mkdir: (dir) => files.mkdir(dir) },
		},
		edit: {
			operations: {
				readFile: (path) => files.readFile(path),
				writeFile: (path, content) => files.writeFile(path, content),
				access: (path) => files.access(path),
			},
		},
		ls: {
			operations: {
				exists: (path) => files.exists(path),
				stat: (path) => files.stat(path),
				readdir: (path) => files.readdir(path),
			},
		},
		find: {
			operations: { exists: (path) => files.exists(path), glob: (pattern, cwd, o) => files.glob(pattern, cwd, o) },
		},
		grep: {
			operations: {
				isDirectory: () => {
					throw new Error("grep does not reach files in a volume sandbox; run rg or grep through bash instead");
				},
				readFile: (path) => files.readFile(path).then((buffer) => buffer.toString("utf-8")),
			},
		},
	};
}
