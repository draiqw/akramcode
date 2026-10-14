import type { Context } from "@akramcode/chord";
import { type ExecutionEnv, getOrThrow } from "../env/index.ts";

/** Tail of the mutation chain of each file, keyed by file system id and canonical path. */
const queues = new Map<string, Promise<void>>();

async function mutationKey(env: ExecutionEnv, path: string, context: Context): Promise<string> {
	const absolutePath = getOrThrow(await env.absolutePath(path, context));
	return `${env.id}\0${await canonical(env, absolutePath, context)}`;
}

// See docs/adr/durable/tools-file-mutation-queue.md#canonical-path-construction
async function canonical(env: ExecutionEnv, absolutePath: string, context: Context): Promise<string> {
	const result = await env.canonicalPath(absolutePath, context);
	if (result.ok) return result.value;
	if (result.error.code === "not_supported") return absolutePath;
	if (result.error.code !== "not_found") throw result.error;
	// The file system splits the path, so a name may contain characters that are separators elsewhere.
	const parent = getOrThrow(await env.joinPath([absolutePath, ".."], context));
	if (parent === absolutePath || !absolutePath.startsWith(parent)) return absolutePath;
	const name = absolutePath.slice(parent.length + (/[/\\]$/.test(parent) ? 0 : 1));
	return getOrThrow(await env.joinPath([await canonical(env, parent, context), name], context));
}

// See docs/adr/durable/tools-file-mutation-queue.md#mutation-serialization
export async function withFileMutationQueue<T>(
	env: ExecutionEnv,
	path: string,
	fn: () => Promise<T>,
	context: Context,
): Promise<T> {
	const key = await mutationKey(env, path, context);
	// Take the slot without awaiting, so no other call can take it in between.
	const previous = queues.get(key) ?? Promise.resolve();
	let release = (): void => {};
	const done = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tail = previous.then(() => done);
	queues.set(key, tail);
	await previous;
	try {
		return await fn();
	} finally {
		release();
		if (queues.get(key) === tail) queues.delete(key);
	}
}
