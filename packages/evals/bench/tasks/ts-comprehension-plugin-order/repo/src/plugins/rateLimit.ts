import type { AppConfig } from "../bootstrap/config.ts";
import type { Middleware } from "../core/types.ts";

export function rateLimit(config: AppConfig): Middleware {
	const counts = new Map<string, number>();
	return async (ctx, next) => {
		const used = (counts.get(ctx.req.ip) ?? 0) + 1;
		counts.set(ctx.req.ip, used);
		if (used > config.rateLimit) {
			ctx.res.status = 429;
			ctx.res.body = { error: "too many requests" };
			return;
		}
		await next();
	};
}
