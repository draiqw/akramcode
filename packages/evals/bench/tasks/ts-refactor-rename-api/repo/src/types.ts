export interface User {
	id: string;
	name: string;
	email: string;
	plan: "free" | "pro" | "enterprise";
	active: boolean;
}

export interface UserStore {
	get(id: string): User | undefined;
}
