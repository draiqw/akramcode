/** Output and exit of one command run inside a sandbox. */
export interface SandboxBashOperations {
	exec(
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			env?: NodeJS.ProcessEnv;
		},
	): Promise<{ exitCode: number | null }>;
}

/** File access inside a sandbox. Paths are absolute and identical to the host paths of the session. */
export interface SandboxFileOperations {
	readFile(path: string): Promise<Buffer>;
	writeFile(path: string, content: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	/** Throws when the path does not exist. */
	access(path: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	stat(path: string): Promise<{ isDirectory(): boolean }>;
	readdir(path: string): Promise<string[]>;
	glob(pattern: string, cwd: string, options: { ignore: string[]; limit: number }): Promise<string[]>;
}

/** A sandbox bound to one session. */
export interface SandboxRuntime {
	readonly provider: string;
	readonly sandboxId: string;
	/** How the session workspace reaches the sandbox: the host folder itself or a cached volume. */
	readonly workspace: SandboxWorkspace;
	readonly bash: SandboxBashOperations;
	/** Present only when the file tools cannot reach the files directly (volume workspace). */
	readonly files?: SandboxFileOperations;
	/** Give the sandbox back: keep it for reuse until it idles out, or delete a throwaway one. */
	release(): Promise<void>;
}

export interface SandboxAcquireRequest {
	sessionId: string;
	/** Session working directory; the workspace is mounted at this same path inside the sandbox. */
	cwd: string;
	signal?: AbortSignal;
}

export interface SandboxProvider {
	readonly name: string;
	acquire(request: SandboxAcquireRequest): Promise<SandboxRuntime>;
}

/**
 * - `mount`: the host working folder is bind-mounted into the sandbox, so the sandbox runs
 *   commands on the real project files and the file tools keep working on the host.
 * - `volume`: a named volume per session holds the workspace, the project is not exposed.
 */
export type SandboxWorkspace = "mount" | "volume";
