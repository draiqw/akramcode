export interface Request {
	method: string;
	path: string;
	headers: Record<string, string>;
	ip: string;
	body?: string;
}

export interface Response {
	status: number;
	headers: Record<string, string>;
	body: unknown;
}

export interface User {
	id: string;
	name: string;
	email: string;
}

export interface Context {
	req: Request;
	res: Response;
	user?: User;
	json?: unknown;
	state: Map<string, unknown>;
}

export type Next = () => Promise<void>;
export type Middleware = (ctx: Context, next: Next) => Promise<void>;
