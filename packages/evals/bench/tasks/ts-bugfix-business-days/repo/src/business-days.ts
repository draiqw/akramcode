const WEEKEND = new Set([0, 6]);

function isWeekend(date: Date): boolean {
	return WEEKEND.has(date.getDay());
}

function dateKey(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export function isBusinessDay(date: Date, holidays: readonly string[] = []): boolean {
	return !isWeekend(date) && !holidays.includes(dateKey(date));
}

/** Move `date` by `n` business days. */
export function addBusinessDays(date: Date, n: number, holidays: readonly string[] = []): Date {
	const result = new Date(date.getTime());
	let remaining = n;
	while (remaining > 0) {
		result.setDate(result.getDate() + 1);
		if (!isWeekend(result)) remaining--;
	}
	return result;
}

/** Count business days d with start < d <= end. */
export function businessDaysBetween(start: Date, end: Date, holidays: readonly string[] = []): number {
	let count = 0;
	const cursor = new Date(start.getTime());
	while (cursor < end) {
		cursor.setDate(cursor.getDate() + 1);
		if (isBusinessDay(cursor, holidays)) count++;
	}
	return count;
}
