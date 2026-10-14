import type { AppConfig } from "../bootstrap/config.ts";
import type { Middleware } from "../core/types.ts";
import { userForToken } from "../data/users.ts";

export function auth(config: AppConfig): Middleware {
	return async (ctx, next) => {
		if (config.publicPaths.includes(ctx.req.path)) {
			await next();
			return;
		}
		const header = ctx.req.headers.authorization ?? "";
		const match = /^Bearer (\S+)$/.exec(header);
		const user = match ? userForToken(match[1]) : undefined;
		if (!user) {
			ctx.res.status = 401;
			ctx.res.body = { error: "unauthorized" };
			return;
		}
		ctx.user = user;
		await next();
	};
}
