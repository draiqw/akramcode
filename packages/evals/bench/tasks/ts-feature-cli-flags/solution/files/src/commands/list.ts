import type { Item } from "../types.ts";

export interface ListOptions {
	all: boolean;
	limit?: number;
}

export function selectItems(items: readonly Item[], options: ListOptions): Item[] {
	const selected = options.all ? [...items] : items.filter((item) => !item.done);
	return options.limit === undefined ? selected : selected.slice(0, options.limit);
}

export function formatText(items: readonly Item[]): string {
	if (items.length === 0) return "no items\n";
	return items.map((item) => `${item.id}\t${item.name}\n`).join("");
}

export function formatJson(items: readonly Item[]): string {
	return `${JSON.stringify(items, null, 2)}\n`;
}
