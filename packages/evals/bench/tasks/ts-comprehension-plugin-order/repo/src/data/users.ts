import type { User } from "../core/types.ts";

const TOKENS: Record<string, User> = {
	"tok-alice": { id: "u-alice", name: "Alice", email: "alice@example.com" },
	"tok-bob": { id: "u-bob", name: "Bob", email: "bob@example.com" },
	"tok-carol": { id: "u-carol", name: "Carol", email: "carol@example.com" },
};

export function userForToken(token: string): User | undefined {
	return TOKENS[token];
}
