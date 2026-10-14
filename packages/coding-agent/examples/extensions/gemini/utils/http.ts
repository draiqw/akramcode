// Adapted from pi-antigravity v0.10.0, commit d59d22b. MIT; see ../LICENSE.
/** Use the host's fetch and proxy configuration without installing a dispatcher. */
export function antigravityFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
	return fetch(input, init);
}
