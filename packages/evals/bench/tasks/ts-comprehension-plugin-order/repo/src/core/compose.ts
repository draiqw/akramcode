import type { Context, Middleware } from "./types.ts";

/** Koa-style composition: each middleware may run code before and after `next()`. */
export function compose(middleware: Middleware[]): (ctx: Context) => Promise<void> {
	return (ctx) => {
		let index = -1;
		const dispatch = async (i: number): Promise<void> => {
			if (i <= index) throw new Error("next() called multiple times");
			index = i;
			const fn = middleware[i];
			if (!fn) return;
			await fn(ctx, () => dispatch(i + 1));
		};
		return dispatch(0);
	};
}
