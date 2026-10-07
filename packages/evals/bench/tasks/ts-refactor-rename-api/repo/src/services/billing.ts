import { fetchUserData } from "../api/users.ts";
import type { UserStore } from "../types.ts";

const MONTHLY_PRICE: Record<string, number> = { free: 0, pro: 12, enterprise: 99 };

export function monthlyCharge(id: string, store?: UserStore): number {
	const user = fetchUserData(id, store);
	if (!user.active) return 0;
	return MONTHLY_PRICE[user.plan] ?? 0;
}

export function annualCharge(id: string, store?: UserStore): number {
	// 2 months free on annual billing
	return monthlyCharge(id, store) * 10;
}
