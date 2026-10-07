export interface Item {
	id: number;
	name: string;
	done: boolean;
}

export interface CliResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export class UsageError extends Error {}
