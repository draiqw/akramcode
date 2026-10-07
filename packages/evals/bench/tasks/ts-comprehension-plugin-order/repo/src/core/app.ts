import { compose } from "./compose.ts";
import type { Context, Middleware, Request, Response } from "./types.ts";

export class App {
	private readonly stack: Middleware[] = [];

	use(middleware: Middleware): this {
		this.stack.push(middleware);
		return this;
	}

	async handle(req: Request): Promise<Response> {
		const ctx: Context = {
			req: { ...req, headers: lowerCaseKeys(req.headers) },
			res: { status: 404, headers: {}, body: null },
			state: new Map(),
		};
		await compose(this.stack)(ctx);
		return ctx.res;
	}
}

function lowerCaseKeys(headers: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
	return out;
}
