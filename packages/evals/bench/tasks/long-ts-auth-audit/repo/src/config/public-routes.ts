import { WEBHOOK_PROVIDERS } from "./webhooks.ts";

/** Routes that anonymous clients may call. Format: "METHOD path", exactly as in each handler's `route`. */
const BASE_PUBLIC = [
	"GET /health",
	"GET /version",
	"POST /auth/login",
	"POST /auth/register",
	"POST /auth/password-reset",
	"GET /docs/:page",
];

export const PUBLIC_ROUTES: readonly string[] = [
	...BASE_PUBLIC,
	...WEBHOOK_PROVIDERS.map((provider) => `POST /webhooks/${provider}`),
	"GET /catalog/public/:id",
];

export function isPublic(method: string, path: string): boolean {
	return PUBLIC_ROUTES.includes(`${method} ${path}`);
}
