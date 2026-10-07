export interface AppConfig {
	/** Requests per client ip before 429 */
	rateLimit: number;
	/** Paths that do not require authentication */
	publicPaths: string[];
	/** Cache lifetime in requests (simple counter-based expiry, deterministic for tests) */
	cacheMaxHits: number;
	corsOrigin: string;
}

export const defaultConfig: AppConfig = {
	rateLimit: 100,
	publicPaths: ["/health", "/api/catalog"],
	cacheMaxHits: 50,
	corsOrigin: "*",
};
