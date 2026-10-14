import type { Item } from "../types.ts";

export interface ListOptions {
	all: boolean;
}

export function selectItems(items: readonly Item[], options: ListOptions): Item[] {
	return options.all ? [...items] : items.filter((item) => !item.done);
}

export function formatText(items: readonly Item[]): string {
	if (items.length === 0) return "no items\n";
	return items.map((item) => `${item.id}\t${item.name}\n`).join("");
}
