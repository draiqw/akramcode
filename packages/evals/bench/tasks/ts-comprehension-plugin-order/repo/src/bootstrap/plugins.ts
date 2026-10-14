/**
 * Order in which plugin middleware is installed. Earlier entries wrap later ones.
 * Keep requestId first so every response gets an id.
 */
export const PLUGIN_ORDER = ["requestId", "logging", "cors", "rateLimit", "cache", "auth", "jsonBody"] as const;

export type PluginName = (typeof PLUGIN_ORDER)[number];
