import type { Router } from "../core/router.ts";

export const catalogStats = { calls: 0 };

const PRODUCTS = [
	{ sku: "p-1", name: "Kettle", price: 39 },
	{ sku: "p-2", name: "Teapot", price: 25 },
];

export function catalogRoutes(router: Router): void {
	router.get("/api/catalog", (ctx) => {
		catalogStats.calls += 1;
		ctx.res.body = { products: PRODUCTS };
	});
}
