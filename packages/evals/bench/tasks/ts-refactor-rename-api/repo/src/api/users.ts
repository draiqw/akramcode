import { defaultStore } from "../db.ts";
import type { User, UserStore } from "../types.ts";

export class UserNotFoundError extends Error {
	readonly userId: string;
	constructor(userId: string) {
		super(`user not found: ${userId}`);
		this.userId = userId;
	}
}

/**
 * Loads a user by id. Ids are trimmed and lower-cased before lookup.
 * Throws UserNotFoundError when the user does not exist.
 */
export function fetchUserData(id: string, store: UserStore = defaultStore): User {
	const key = id.trim().toLowerCase();
	const user = store.get(key);
	if (!user) throw new UserNotFoundError(key);
	return user;
}

export function userExists(id: string, store: UserStore = defaultStore): boolean {
	try {
		fetchUserData(id, store);
		return true;
	} catch (error) {
		if (error instanceof UserNotFoundError) return false;
		throw error;
	}
}
