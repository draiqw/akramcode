import type { Component } from "@akramcode/tui";
import { theme } from "../theme/theme.ts";

/** Cells by intensity: no use, then quartiles of the busiest days. */
const LEVEL_CELLS = ["·", "░", "▒", "▓", "█"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ROW_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
const LABEL_WIDTH = 4;
const MAX_WEEKS = 53;

/** Local calendar day, e.g. "2026-10-11". */
export function localDayKey(timestamp: number): string {
	const date = new Date(timestamp);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Intensity 0-4 of a day by its rank among days with use, like GitHub's contribution graph; the busiest day is 4. */
function getLevel(value: number, sortedNonZero: readonly number[]): number {
	if (value <= 0) return 0;
	if (sortedNonZero.length === 1) return 4;
	const rank = sortedNonZero.findIndex((v) => v >= value);
	return 1 + Math.round((rank / (sortedNonZero.length - 1)) * 3);
}

/**
 * GitHub-style activity graph: one column per week ending with the current one, one row per weekday
 * (Monday first), month labels above, and a legend below.
 */
export function renderUsageHeatmap(tokensByDay: ReadonlyMap<string, number>, width: number, now: number): string[] {
	const weeks = Math.max(1, Math.min(MAX_WEEKS, Math.floor((width - LABEL_WIDTH) / 2)));
	const today = new Date(now);
	const mondayOffset = (today.getDay() + 6) % 7;
	const firstMonday = new Date(
		today.getFullYear(),
		today.getMonth(),
		today.getDate() - mondayOffset - (weeks - 1) * 7,
	);
	const sortedNonZero = [...tokensByDay.values()].filter((v) => v > 0).sort((a, b) => a - b);

	const dayAt = (week: number, weekday: number) =>
		new Date(firstMonday.getFullYear(), firstMonday.getMonth(), firstMonday.getDate() + week * 7 + weekday);

	let monthRow = " ".repeat(LABEL_WIDTH);
	let lastMonth = -1;
	for (let week = 0; week < weeks; week++) {
		const month = dayAt(week, 0).getMonth();
		const column = LABEL_WIDTH + week * 2;
		if (month !== lastMonth && column >= monthRow.length && column + MONTHS[month]!.length <= width) {
			monthRow = monthRow.padEnd(column) + MONTHS[month];
			lastMonth = month;
		}
	}

	const lines = [theme.fg("dim", monthRow)];
	for (let weekday = 0; weekday < 7; weekday++) {
		const cells: string[] = [];
		for (let week = 0; week < weeks; week++) {
			const day = dayAt(week, weekday);
			if (day.getTime() > now) break;
			const level = getLevel(tokensByDay.get(localDayKey(day.getTime())) ?? 0, sortedNonZero);
			cells.push(level === 0 ? theme.fg("dim", LEVEL_CELLS[0]!) : theme.fg("success", LEVEL_CELLS[level]!));
		}
		const label = ROW_LABELS[weekday]!;
		lines.push(
			cells.length > 0 ? theme.fg("dim", label.padEnd(LABEL_WIDTH)) + cells.join(" ") : theme.fg("dim", label),
		);
	}
	const legend = LEVEL_CELLS.map((cell, level) => (level === 0 ? theme.fg("dim", cell) : theme.fg("success", cell)));
	lines.push(`${" ".repeat(LABEL_WIDTH)}${theme.fg("dim", "Less")} ${legend.join(" ")} ${theme.fg("dim", "More")}`);
	return lines;
}

/** Chat component for the activity graph; it fills the available width with weeks. */
export class UsageHeatmapComponent implements Component {
	private readonly tokensByDay: ReadonlyMap<string, number>;
	private readonly now: number;
	private readonly padding: number;

	constructor(tokensByDay: ReadonlyMap<string, number>, now: number, padding = 1) {
		this.tokensByDay = tokensByDay;
		this.now = now;
		this.padding = padding;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const pad = " ".repeat(this.padding);
		return renderUsageHeatmap(this.tokensByDay, Math.max(1, width - this.padding), this.now).map(
			(line) => pad + line,
		);
	}
}
