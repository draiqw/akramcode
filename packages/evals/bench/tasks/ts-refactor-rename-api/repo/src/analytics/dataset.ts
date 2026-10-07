import { defaultStore } from "../db.ts";
import type { UserStore } from "../types.ts";

/**
 * Not related to fetchUserData in api/users.ts: this builds an analytics
 * dataset (one row per id) and must keep its name.
 */
export function fetchUserDataset(ids: string[], store: UserStore = defaultStore): Array<[string, boolean]> {
	return ids.map((id) => [id, store.get(id) !== undefined]);
}
