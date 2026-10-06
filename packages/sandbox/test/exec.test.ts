import type { Sandbox } from "@alibaba-group/opensandbox";
import { describe, expect, it } from "vitest";
import { createSandboxBashOperations, type SessionHost } from "../src/exec.ts";

type Handlers = { onStdout?: (m: { text: string }) => void; onStderr?: (m: { text: string }) => void };

function host(
	run: (
		command: string,
		handlers: Handlers,
		signal?: AbortSignal,
	) => Promise<{ exitCode?: number | null; error?: unknown }>,
) {
	const interrupted: string[] = [];
	let sessions = 0;
	const sandbox = {
		commands: {
			createSession: async () => `s${++sessions}`,
			deleteSession: async () => undefined,
			interrupt: async (id: string) => {
				interrupted.push(id);
			},
			runInSession: async (_id: string, command: string, _o: unknown, handlers: Handlers, signal?: AbortSignal) =>
				run(command, handlers, signal),
		},
	} as unknown as Sandbox;
	const state: SessionHost = { sandbox, cwd: "/p" };
	return { state, interrupted, sessions: () => sessions };
}

describe("sandbox bash operations", () => {
	it("streams output lines and returns the exit code", async () => {
		const h = host(async (_c, handlers) => {
			handlers.onStdout?.({ text: "a" });
			handlers.onStderr?.({ text: "b" });
			return { exitCode: 2 };
		});
		let out = "";
		const result = await createSandboxBashOperations(h.state).exec("x", "/p", {
			onData: (d) => {
				out += d.toString();
			},
		});
		expect(out).toBe("a\nb\n");
		expect(result).toEqual({ exitCode: 2 });
	});

	it("forwards only AKRAMCODE_ variables", async () => {
		let seen = "";
		const h = host(async (command) => {
			seen = command;
			return { exitCode: 0 };
		});
		await createSandboxBashOperations(h.state).exec("ls", "/p", {
			onData: () => undefined,
			env: { PATH: "/bin", AKRAMCODE_SESSION_ID: "id" },
		});
		expect(seen).toBe("export AKRAMCODE_SESSION_ID='id'\nls");
	});

	it("recreates the session once when it failed without output", async () => {
		let calls = 0;
		const h = host(async () => {
			if (++calls === 1) throw new Error("session gone");
			return { exitCode: 0 };
		});
		const result = await createSandboxBashOperations(h.state).exec("x", "/p", { onData: () => undefined });
		expect(result.exitCode).toBe(0);
		expect(h.sessions()).toBe(2);
	});

	it("does not retry a command that already produced output", async () => {
		const h = host(async (_c, handlers) => {
			handlers.onStdout?.({ text: "partial" });
			throw new Error("boom");
		});
		await expect(createSandboxBashOperations(h.state).exec("x", "/p", { onData: () => undefined })).rejects.toThrow(
			"boom",
		);
		expect(h.sessions()).toBe(1);
	});

	it("reports an abort and interrupts the session", async () => {
		const controller = new AbortController();
		const h = host(
			(_c, _h, signal) =>
				new Promise((_resolve, reject) => {
					signal?.addEventListener("abort", () => reject(new Error("fetch aborted")));
				}),
		);
		const pending = createSandboxBashOperations(h.state).exec("sleep", "/p", {
			onData: () => undefined,
			signal: controller.signal,
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		controller.abort();
		await expect(pending).rejects.toThrow("aborted");
		expect(h.interrupted).toEqual(["s1"]);
	});

	it("interrupts the session when the timeout elapses", async () => {
		const h = host(() => new Promise(() => undefined));
		const pending = createSandboxBashOperations(h.state).exec("sleep", "/p", {
			onData: () => undefined,
			timeout: 0.02,
		});
		await expect(
			Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve("hung"), 200))]),
		).resolves.toBe("hung");
		expect(h.interrupted).toEqual(["s1"]);
	});
});
