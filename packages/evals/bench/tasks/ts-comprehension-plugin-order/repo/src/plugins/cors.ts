import type { AppConfig } from "../bootstrap/config.ts";
import type { Middleware } from "../core/types.ts";

export function cors(config: AppConfig): Middleware {
	return async (ctx, next) => {
		ctx.res.headers["access-control-allow-origin"] = config.corsOrigin;
		if (ctx.req.method === "OPTIONS") {
			ctx.res.status = 204;
			ctx.res.headers["access-control-allow-methods"] = "GET,POST,OPTIONS";
			ctx.res.headers["access-control-allow-headers"] = "authorization,content-type";
			ctx.res.body = null;
			return;
		}
		await next();
	};
}
