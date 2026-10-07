import * as api from "../api/index.ts";
import type { UserStore } from "../types.ts";

export interface AdminResponse {
	status: number;
	body: string;
}

export function handleGetUser(id: string, store?: UserStore): AdminResponse {
	try {
		const user = api.fetchUserData(id, store);
		return { status: 200, body: JSON.stringify(user) };
	} catch (error) {
		if (error instanceof api.UserNotFoundError) return { status: 404, body: error.message };
		throw error;
	}
}
