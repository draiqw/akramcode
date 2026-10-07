import type { Middleware } from "../core/types.ts";

export function jsonBody(): Middleware {
	return async (ctx, next) => {
		if (ctx.req.method === "POST" && ctx.req.body !== undefined) {
			try {
				ctx.json = JSON.parse(ctx.req.body);
			} catch {
				ctx.res.status = 400;
				ctx.res.body = { error: "invalid json" };
				return;
			}
		}
		await next();
	};
}
