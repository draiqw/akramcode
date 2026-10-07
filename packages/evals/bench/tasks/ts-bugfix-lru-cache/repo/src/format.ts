/** Render cache statistics for debug logs. */
export function formatStats(name: string, size: number, capacity: number): string {
	const pct = capacity === 0 ? 0 : Math.round((size / capacity) * 100);
	return `${name}: ${size}/${capacity} (${pct}%)`;
}
