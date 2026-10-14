import type { AppConfig } from "../bootstrap/config.ts";
import type { Middleware, Response } from "../core/types.ts";

interface Entry {
	response: Response;
	hits: number;
}

/**
 * Response cache for GET requests. Entries are scoped per user (anonymous
 * requests share the "anon" scope), so private responses are never shared
 * between users.
 */
export function cache(config: AppConfig): Middleware {
	const entries = new Map<string, Entry>();
	return async (ctx, next) => {
		if (ctx.req.method !== "GET") {
			await next();
			return;
		}
		const scope = ctx.user?.id ?? "anon";
		const key = `${scope}:${ctx.req.path}`;
		const hit = entries.get(key);
		if (hit && hit.hits < config.cacheMaxHits) {
			hit.hits += 1;
			ctx.res.status = hit.response.status;
			ctx.res.body = structuredClone(hit.response.body);
			Object.assign(ctx.res.headers, hit.response.headers, { "x-cache": "HIT" });
			return;
		}
		await next();
		if (ctx.res.status === 200) {
			const headers = { ...ctx.res.headers };
			delete headers["x-request-id"];
			entries.set(key, { response: { status: 200, headers, body: structuredClone(ctx.res.body) }, hits: 0 });
		}
		ctx.res.headers["x-cache"] = "MISS";
	};
}
