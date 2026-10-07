import type { User, UserStore } from "./types.ts";

const SEED: User[] = [
	{ id: "u1", name: "Ada Lovelace", email: "ada@example.com", plan: "pro", active: true },
	{ id: "u2", name: "Alan Turing", email: "alan@example.com", plan: "free", active: true },
	{ id: "u3", name: "Grace Hopper", email: "grace@example.com", plan: "enterprise", active: false },
];

export class MemoryUserStore implements UserStore {
	private readonly users: Map<string, User>;

	constructor(users: User[] = SEED) {
		this.users = new Map(users.map((u) => [u.id, { ...u }]));
	}

	get(id: string): User | undefined {
		const user = this.users.get(id);
		return user ? { ...user } : undefined;
	}
}

export const defaultStore = new MemoryUserStore();
