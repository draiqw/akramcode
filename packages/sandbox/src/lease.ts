import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One lease per session: a second akramcode process on the same session must not drive the same
 * reusable sandbox. A lease whose process is gone is taken over.
 */
export class FileLeaseStore {
	private readonly directory: string;

	constructor(directory: string) {
		this.directory = directory;
	}

	private path(key: string): string {
		return join(this.directory, `${key.replace(/[^A-Za-z0-9_-]/g, "_")}.lease`);
	}

	tryAcquire(key: string): boolean {
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		const path = this.path(key);
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				writeFileSync(path, String(process.pid), { flag: "wx", mode: 0o600 });
				return true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				const holder = Number(readFileSync(path, "utf-8").trim());
				if (holder === process.pid || isAlive(holder)) return holder === process.pid;
				unlinkSync(path);
			}
		}
		return false;
	}

	release(key: string): void {
		const path = this.path(key);
		try {
			if (Number(readFileSync(path, "utf-8").trim()) === process.pid) unlinkSync(path);
		} catch {
			// Already gone.
		}
	}
}

function isAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}
