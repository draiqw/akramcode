import { fetchUserData } from "../api/index.ts";
import type { UserStore } from "../types.ts";

export interface ProfileCard {
	title: string;
	subtitle: string;
}

export function buildProfileCard(id: string, store?: UserStore): ProfileCard {
	const user = fetchUserData(id, store);
	const badge = user.plan === "free" ? "" : ` [${user.plan.toUpperCase()}]`;
	return { title: `${user.name}${badge}`, subtitle: user.email };
}
