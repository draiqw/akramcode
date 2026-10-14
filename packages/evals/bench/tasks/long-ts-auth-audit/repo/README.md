# api-handlers

One HTTP handler per file under `src/routes/<area>/`. Each file exports `route` (method and path) and
an async `handler(ctx)`. Authentication helpers live in `src/auth.ts`; the list of public routes is in
`src/config/public-routes.ts`.

Run tests: `node --test test/*.test.ts` (Node 22.19+, no dependencies).
