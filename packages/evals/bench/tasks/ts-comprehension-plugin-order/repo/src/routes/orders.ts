import type { Router } from "../core/router.ts";

export function orderRoutes(router: Router): void {
	let nextId = 1;
	router.post("/api/orders", (ctx) => {
		const payload = (ctx.json ?? {}) as { sku?: string; qty?: number };
		if (!payload.sku) {
			ctx.res.status = 422;
			ctx.res.body = { error: "sku required" };
			return;
		}
		ctx.res.status = 201;
		ctx.res.body = { id: nextId++, sku: payload.sku, qty: payload.qty ?? 1, user: ctx.user?.id };
	});
}
