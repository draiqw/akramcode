/** How long a prompt given as an argument waits for piped input to start before running without it. */
export const STDIN_START_TIMEOUT_MS = 2000;

/**
 * Reads piped input until it ends. With `startTimeoutMs`, an input that sends nothing within that
 * time is treated as absent, so a script that leaves stdin open (cron, another process) does not
 * hang the run. Once data has started to arrive, the input is read to its end.
 */
export function readPipedStdin(stream: NodeJS.ReadStream, startTimeoutMs?: number): Promise<string | undefined> {
	if (stream.isTTY) return Promise.resolve(undefined);
	return new Promise((resolve) => {
		let data = "";
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (value: string | undefined): void => {
			if (timer) clearTimeout(timer);
			stream.off("data", onData);
			stream.off("end", onEnd);
			stream.pause();
			resolve(value);
		};
		const onData = (chunk: string): void => {
			if (timer) {
				clearTimeout(timer);
				timer = undefined;
			}
			data += chunk;
		};
		const onEnd = (): void => finish(data.trim() || undefined);
		stream.setEncoding("utf8");
		stream.on("data", onData);
		stream.on("end", onEnd);
		if (startTimeoutMs !== undefined) timer = setTimeout(() => finish(undefined), startTimeoutMs);
		stream.resume();
	});
}
