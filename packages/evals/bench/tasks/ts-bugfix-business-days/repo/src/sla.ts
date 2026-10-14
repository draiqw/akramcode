import { addBusinessDays } from "./business-days.ts";

export interface Ticket {
	id: string;
	openedAt: Date;
	priority: "low" | "normal" | "high";
}

const SLA_DAYS: Record<Ticket["priority"], number> = { low: 10, normal: 5, high: 1 };

/** Due date of a support ticket according to the SLA table. */
export function dueDate(ticket: Ticket, holidays: readonly string[] = []): Date {
	return addBusinessDays(ticket.openedAt, SLA_DAYS[ticket.priority], holidays);
}
