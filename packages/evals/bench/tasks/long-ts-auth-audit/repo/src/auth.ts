import type { Ctx } from "./types.ts";

export class AuthError extends Error {
	readonly status = 401;
}

/** Throws AuthError unless the request is authenticated. */
export function requireAuth(ctx: Ctx): void {
	if (!ctx.user) throw new AuthError("authentication required");
}

/**
 * Soft check used by a few legacy handlers: it only records whether a user is present and never
 * rejects a request. It does NOT protect a route.
 */
export function requireAuthOptional(ctx: Ctx): boolean {
	return ctx.user !== undefined;
}
