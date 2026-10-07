import type { Router } from "../core/router.ts";

export function meRoutes(router: Router): void {
	router.get("/api/me", (ctx) => {
		const user = ctx.user;
		if (!user) {
			// auth middleware guarantees a user here
			ctx.res.status = 500;
			ctx.res.body = { error: "no user" };
			return;
		}
		ctx.res.body = { id: user.id, name: user.name, email: user.email };
	});
}
