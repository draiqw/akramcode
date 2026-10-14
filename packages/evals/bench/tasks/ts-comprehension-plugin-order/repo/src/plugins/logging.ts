import type { Middleware } from "../core/types.ts";

export interface LogSink {
	lines: string[];
}

export function logging(sink: LogSink): Middleware {
	return async (ctx, next) => {
		await next();
		sink.lines.push(`${ctx.req.method} ${ctx.req.path} ${ctx.res.status} ${String(ctx.state.get("requestId"))}`);
	};
}
