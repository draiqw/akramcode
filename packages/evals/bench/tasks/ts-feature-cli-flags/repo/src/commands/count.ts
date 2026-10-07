import type { Item } from "../types.ts";

export function formatCount(items: readonly Item[]): string {
	const done = items.filter((item) => item.done).length;
	return `${items.length} items, ${done} done\n`;
}
