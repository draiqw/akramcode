import type { Middleware } from "../core/types.ts";

export function requestId(): Middleware {
	let counter = 0;
	return async (ctx, next) => {
		counter += 1;
		const id = ctx.req.headers["x-request-id"] ?? `req-${counter}`;
		ctx.state.set("requestId", id);
		try {
			await next();
		} finally {
			ctx.res.headers["x-request-id"] = id;
		}
	};
}
