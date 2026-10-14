import { fetchUserData as getUser } from "../api/index.ts";
import type { User, UserStore } from "../types.ts";

/** Loads several users, skipping ids that do not exist. */
export function loadMany(ids: string[], store?: UserStore): User[] {
	const out: User[] = [];
	for (const id of ids) {
		try {
			out.push(getUser(id, store));
		} catch {
			// skip unknown ids
		}
	}
	return out;
}
