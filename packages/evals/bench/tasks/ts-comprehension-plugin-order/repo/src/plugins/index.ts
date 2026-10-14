import type { AppConfig } from "../bootstrap/config.ts";
import type { PluginName } from "../bootstrap/plugins.ts";
import type { Middleware } from "../core/types.ts";
import { auth } from "./auth.ts";
import { cache } from "./cache.ts";
import { cors } from "./cors.ts";
import { jsonBody } from "./jsonBody.ts";
import { type LogSink, logging } from "./logging.ts";
import { rateLimit } from "./rateLimit.ts";
import { requestId } from "./requestId.ts";

export interface PluginDeps {
	config: AppConfig;
	logSink: LogSink;
}

export const PLUGINS: Record<PluginName, (deps: PluginDeps) => Middleware> = {
	requestId: () => requestId(),
	logging: (deps) => logging(deps.logSink),
	cors: (deps) => cors(deps.config),
	rateLimit: (deps) => rateLimit(deps.config),
	cache: (deps) => cache(deps.config),
	auth: (deps) => auth(deps.config),
	jsonBody: () => jsonBody(),
};
