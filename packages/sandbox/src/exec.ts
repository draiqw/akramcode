import type { Sandbox } from "@alibaba-group/opensandbox";
import { withForwardedEnv } from "./shell.ts";
import type { SandboxBashOperations } from "./types.ts";

/** A sandbox plus the shell session commands run in. */
export interface SessionHost {
	sandbox: Sandbox;
	cwd: string;
	sessionId?: string;
	closeSession?: () => Promise<void>;
}

async function ensureSession(host: SessionHost): Promise<string> {
	if (host.sessionId) return host.sessionId;
	const id = await host.sandbox.commands.createSession({ workingDirectory: host.cwd });
	host.sessionId = id;
	host.closeSession = async () => {
		const current = host.sessionId;
		host.sessionId = undefined;
		if (current) await host.sandbox.commands.deleteSession(current).catch(() => undefined);
	};
	return id;
}

/**
 * Commands run in one persistent shell session of the sandbox, so a command costs one request
 * instead of a process start. A session that has gone away is recreated once, and only when the
 * failed attempt produced no output, because commands are not idempotent.
 */
export function createSandboxBashOperations(host: SessionHost): SandboxBashOperations {
	return {
		async exec(command, cwd, { onData, signal, timeout, env }) {
			const script = withForwardedEnv(command, env);
			for (let attempt = 0; ; attempt++) {
				let produced = false;
				let timedOut = false;
				const sessionId = await ensureSession(host);
				const emit = (text: string): void => {
					produced = true;
					onData(Buffer.from(`${text}\n`));
				};
				const timer =
					timeout === undefined
						? undefined
						: setTimeout(() => {
								timedOut = true;
								void host.sandbox.commands.interrupt(sessionId).catch(() => undefined);
							}, timeout * 1000);
				const onAbort = (): void => {
					void host.sandbox.commands.interrupt(sessionId).catch(() => undefined);
				};
				signal?.addEventListener("abort", onAbort, { once: true });
				try {
					if (signal?.aborted) throw new Error("aborted");
					const result = await host.sandbox.commands.runInSession(
						sessionId,
						script,
						{ workingDirectory: cwd },
						{ onStdout: (m) => emit(m.text), onStderr: (m) => emit(m.text), skipAccumulation: true },
						signal,
					);
					if (timedOut) throw new Error(`timeout:${timeout}`);
					if (signal?.aborted) throw new Error("aborted");
					return { exitCode: result.exitCode ?? (result.error ? 1 : 0) };
				} catch (error) {
					if (signal?.aborted) throw new Error("aborted");
					if (timedOut) throw new Error(`timeout:${timeout}`);
					if (attempt === 0 && !produced) {
						host.sessionId = undefined;
						continue;
					}
					throw error;
				} finally {
					if (timer) clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
				}
			}
		},
	};
}
