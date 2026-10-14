const DAY_MS = 86_400_000;

function utcMidnight(date: Date): number {
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dateKey(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export function isBusinessDay(date: Date, holidays: readonly string[] = []): boolean {
	const day = date.getUTCDay();
	return day !== 0 && day !== 6 && !holidays.includes(dateKey(date));
}

/** Move `date` by `n` business days. */
export function addBusinessDays(date: Date, n: number, holidays: readonly string[] = []): Date {
	if (!Number.isInteger(n)) throw new RangeError(`n must be an integer, got ${n}`);
	const result = new Date(date.getTime());
	const step = n < 0 ? -1 : 1;
	let remaining = Math.abs(n);
	while (remaining > 0) {
		result.setUTCDate(result.getUTCDate() + step);
		if (isBusinessDay(result, holidays)) remaining--;
	}
	return result;
}

/** Count business days d with start < d <= end. */
export function businessDaysBetween(start: Date, end: Date, holidays: readonly string[] = []): number {
	const from = utcMidnight(start);
	const to = utcMidnight(end);
	if (to < from) return -businessDaysBetween(end, start, holidays);
	let count = 0;
	for (let t = from + DAY_MS; t <= to; t += DAY_MS) {
		if (isBusinessDay(new Date(t), holidays)) count++;
	}
	return count;
}
