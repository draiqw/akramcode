import type { Context, Middleware } from "./types.ts";

export type Handler = (ctx: Context) => void | Promise<void>;

export class Router {
	private readonly routes = new Map<string, Handler>();

	get(path: string, handler: Handler): this {
		this.routes.set(`GET ${path}`, handler);
		return this;
	}

	post(path: string, handler: Handler): this {
		this.routes.set(`POST ${path}`, handler);
		return this;
	}

	middleware(): Middleware {
		return async (ctx) => {
			const handler = this.routes.get(`${ctx.req.method} ${ctx.req.path}`);
			if (!handler) {
				ctx.res.status = 404;
				ctx.res.body = { error: "not found" };
				return;
			}
			ctx.res.status = 200;
			await handler(ctx);
		};
	}
}
