import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Ctx, Reply, RouteDef } from "./types.ts";

export interface LoadedRoute {
	file: string;
	route: RouteDef;
	handler: (ctx: Ctx) => Promise<Reply>;
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else if (entry.name.endsWith(".ts")) out.push(full);
	}
	return out.sort();
}

/** Import every handler module under src/routes. */
export async function loadRoutes(): Promise<LoadedRoute[]> {
	const files = walk(join(ROOT, "src", "routes"));
	const loaded: LoadedRoute[] = [];
	for (const file of files) {
		const mod = await import(pathToFileURL(file).href);
		loaded.push({ file: relative(ROOT, file).split("\\").join("/"), route: mod.route, handler: mod.handler });
	}
	return loaded;
}
