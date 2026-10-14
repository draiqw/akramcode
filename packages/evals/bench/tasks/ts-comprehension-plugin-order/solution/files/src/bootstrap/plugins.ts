/**
 * Order in which plugin middleware is installed. Earlier entries wrap later ones.
 * Keep requestId first so every response gets an id. auth must run before cache
 * because cache entries are scoped by the authenticated user.
 */
export const PLUGIN_ORDER = ["requestId", "logging", "cors", "rateLimit", "auth", "cache", "jsonBody"] as const;

export type PluginName = (typeof PLUGIN_ORDER)[number];
