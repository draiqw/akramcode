import type { Router } from "../core/router.ts";

export function healthRoutes(router: Router): void {
	router.get("/health", (ctx) => {
		ctx.res.body = { ok: true };
	});
}
