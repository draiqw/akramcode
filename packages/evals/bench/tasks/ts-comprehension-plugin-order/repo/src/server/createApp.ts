import { type AppConfig, defaultConfig } from "../bootstrap/config.ts";
import { PLUGIN_ORDER } from "../bootstrap/plugins.ts";
import { App } from "../core/app.ts";
import { Router } from "../core/router.ts";
import type { LogSink } from "../plugins/logging.ts";
import { PLUGINS } from "../plugins/index.ts";
import { catalogRoutes } from "../routes/catalog.ts";
import { healthRoutes } from "../routes/health.ts";
import { meRoutes } from "../routes/me.ts";
import { orderRoutes } from "../routes/orders.ts";

export interface CreatedApp {
	app: App;
	logSink: LogSink;
}

export function createApp(overrides: Partial<AppConfig> = {}): CreatedApp {
	const config: AppConfig = { ...defaultConfig, ...overrides };
	const logSink: LogSink = { lines: [] };
	const app = new App();
	for (const name of PLUGIN_ORDER) {
		app.use(PLUGINS[name]({ config, logSink }));
	}
	const router = new Router();
	healthRoutes(router);
	catalogRoutes(router);
	meRoutes(router);
	orderRoutes(router);
	app.use(router.middleware());
	return { app, logSink };
}
