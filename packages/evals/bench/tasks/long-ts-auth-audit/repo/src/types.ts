export interface User {
	id: string;
	roles: string[];
}

export interface Db {
	get(key: string): Promise<unknown>;
	list(prefix: string): Promise<string[]>;
	put(key: string, value: unknown): Promise<boolean>;
}

export interface Ctx {
	user?: User;
	params: Record<string, string>;
	body?: unknown;
	db: Db;
}

export interface Reply {
	status: number;
	body: unknown;
}

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export interface RouteDef {
	method: Method;
	path: string;
}
