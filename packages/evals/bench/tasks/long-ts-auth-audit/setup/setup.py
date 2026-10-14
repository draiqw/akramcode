"""Generate ~75 route handler files under src/routes (cwd = workspace).

`python3 setup.py --expected` prints hidden expectations instead.
The reference solution imports this file and renders fixed handlers with `render(route, fixed=True)`.
"""

import json
import os
import random
import sys

AREAS = ["users", "orders", "invoices", "products", "teams", "projects", "reports", "admin", "files", "notifications"]
PUBLIC = {
    "GET /health",
    "GET /version",
    "POST /auth/login",
    "POST /auth/register",
    "POST /auth/password-reset",
    "GET /docs/:page",
    "POST /webhooks/stripe",
    "POST /webhooks/github",
    "POST /webhooks/slack",
    "GET /catalog/public/:id",
}
# Routes that look public but are not in the list.
LOOKALIKES = ["POST /webhooks/paypal", "POST /auth/logout", "GET /catalog/:id", "GET /docs/:page/edit-history"]
PUBLIC_WRONG = {"POST /webhooks/github", "GET /docs/:page", "GET /catalog/public/:id"}
FIELDS = ["id", "name", "status", "owner", "createdAt", "updatedAt", "tags", "amount", "region", "note"]
FIELD_TYPES = {"id": "string", "name": "string", "status": "string", "owner": "string", "createdAt": "number", "updatedAt": "number", "tags": "object", "amount": "number", "region": "string", "note": "string"}


def plan():
    rng = random.Random(5150)
    routes = []
    for area in AREAS:
        res = area[:-1] if area.endswith("s") else area
        candidates = [
            ("GET", f"/api/{area}", "list"),
            ("GET", f"/api/{area}/:id", "get"),
            ("POST", f"/api/{area}", "create"),
            ("PUT", f"/api/{area}/:id", "update"),
            ("DELETE", f"/api/{area}/:id", "delete"),
            ("GET", f"/api/{area}/:id/history", "history"),
            ("GET", f"/api/{area}/:id/related", "related"),
        ]
        for method, path, kind in rng.sample(candidates, rng.randint(5, 7)):
            routes.append({"method": method, "path": path, "kind": kind, "res": res, "area": area})
    for key in sorted(PUBLIC) + LOOKALIKES:
        method, path = key.split(" ", 1)
        if path in ("/health", "/version") or path.startswith("/auth/") or path.startswith("/webhooks/"):
            kind = "static"
        elif path.startswith("/docs/"):
            kind = "get"
        else:
            kind = "get"
        area = path.strip("/").split("/")[0]
        routes.append({"method": method, "path": path, "kind": kind, "res": area, "area": area})
    states = ["ok"] * 14 + ["missing"] * 3 + ["misplaced"] + ["commented"] + ["optional"]
    for r in routes:
        key = f"{r['method']} {r['path']}"
        r["key"] = key
        r["public"] = key in PUBLIC
        r["seed"] = rng.randint(1, 10**6)
        if r["public"]:
            r["state"] = "public_wrong" if key in PUBLIC_WRONG else "public_ok"
        else:
            r["state"] = rng.choice(states)
            if r["state"] == "misplaced" and r["kind"] == "static":
                r["state"] = "missing"
        slug = r["path"].strip("/").replace("/:", "/by-").replace("/", "-").replace(":", "")
        r["file"] = f"src/routes/{r['area']}/{r['method'].lower()}-{slug}.ts"
    return routes


def body_lines(r):
    k, res = r["kind"], r["res"]
    param = "page" if r["path"].startswith("/docs/") else "id"
    if k == "static":
        return [f'return {{ status: 200, body: {{ ok: true, route: "{r["key"]}" }} }};']
    if k in ("get",):
        return [
            f'const item = await ctx.db.get("{res}:" + ctx.params.{param});',
            "return { status: 200, body: item };",
        ]
    if k in ("list",):
        return [f'const items = await ctx.db.list("{res}");', "return { status: 200, body: { count: items.length, items } };"]
    if k in ("create",):
        return [f'const ok = await ctx.db.put("{res}:new", ctx.body);', "return { status: ok ? 201 : 500, body: null };"]
    if k in ("update",):
        return [
            f'const ok = await ctx.db.put("{res}:" + ctx.params.id, ctx.body);',
            "return { status: ok ? 200 : 500, body: null };",
        ]
    if k == "delete":
        return [
            f'const existing = await ctx.db.get("{res}:" + ctx.params.id);',
            f'const ok = await ctx.db.put("{res}:" + ctx.params.id, null);',
            "return { status: ok ? 204 : 500, body: { deleted: existing } };",
        ]
    # history / related
    return [
        f'const current = await ctx.db.get("{res}:" + ctx.params.id);',
        f'const entries = await ctx.db.list("{res}:" + ctx.params.id + ":{k}");',
        "return { status: 200, body: { current, entries: entries.length } };",
    ]


def expected_reply(r):
    k, res = r["kind"], r["res"]
    pid = "intro" if r["path"].startswith("/docs/") else "42"
    if k == "static":
        return {"status": 200, "body": {"ok": True, "route": r["key"]}}
    if k == "get":
        return {"status": 200, "body": {"key": f"{res}:{pid}"}}
    if k == "list":
        return {"status": 200, "body": {"count": 2, "items": [f"{res}:1", f"{res}:2"]}}
    if k == "create":
        return {"status": 201, "body": None}
    if k == "update":
        return {"status": 200, "body": None}
    if k == "delete":
        return {"status": 204, "body": {"deleted": {"key": f"{res}:42"}}}
    return {"status": 200, "body": {"current": {"key": f"{res}:42"}, "entries": 2}}


def render(r, fixed=False):
    rng = random.Random(r["seed"])
    state = r["state"]
    if fixed:
        state = "public_ok" if r["public"] else "ok"
    body = body_lines(r)
    lines = []
    if state in ("ok", "public_wrong"):
        lines = ["requireAuth(ctx);"] + body
    elif state == "misplaced":
        lines = body[:1] + ["requireAuth(ctx);"] + body[1:]
    elif state == "commented":
        lines = ["// requireAuth(ctx); TODO: re-enable after the mobile client ships"] + body
    elif state == "optional":
        lines = ["const signedIn = requireAuthOptional(ctx);", 'void signedIn;'] + body
    else:
        lines = list(body)
    uses = []
    joined = "\n".join(lines)
    if "requireAuth(ctx)" in joined.replace("// requireAuth", ""):
        uses.append("requireAuth")
    if "requireAuthOptional" in joined:
        uses.append("requireAuthOptional")
    fields = rng.sample(FIELDS, rng.randint(3, 6))
    desc = {
        "static": "Static response used by probes and integrations.",
        "get": f"Returns a single {r['res']} record.",
        "list": f"Lists all {r['res']} records.",
        "create": f"Creates a {r['res']} record from the request body.",
        "update": f"Replaces a {r['res']} record with the request body.",
        "delete": f"Deletes a {r['res']} record and returns the previous value.",
        "history": f"Returns the {r['res']} record and the size of its change history.",
        "related": f"Returns the {r['res']} record and how many related records it has.",
    }[r["kind"]]
    out = []
    if uses:
        out.append(f'import {{ {", ".join(uses)} }} from "../../auth.ts";')
    out.append('import type { Ctx, Reply, RouteDef } from "../../types.ts";')
    out.append("")
    out.append(f'export const route: RouteDef = {{ method: "{r["method"]}", path: "{r["path"]}" }};')
    out.append("")
    out.append("/** Fields exposed by this endpoint (documentation only). */")
    out.append(f"export const FIELDS = {json.dumps(fields)};")
    out.append("")
    out.append("/** Request body schema (documentation and validation only). */")
    out.append("export const SCHEMA: Record<string, string> = {")
    for field in fields:
        out.append(f'\t{field}: "{FIELD_TYPES[field]}",')
    out.append("};")
    out.append("")
    out.append("/** Returns the schema violations in a request body. Not used by the handler itself. */")
    out.append("export function validate(body: unknown): string[] {")
    out.append('\tif (body === null || typeof body !== "object") return ["body must be an object"];')
    out.append("\tconst errors: string[] = [];")
    out.append("\tfor (const [field, type] of Object.entries(SCHEMA)) {")
    out.append("\t\tconst value = (body as Record<string, unknown>)[field];")
    out.append("\t\tif (value !== undefined && typeof value !== type) errors.push(`${field} must be ${type}`);")
    out.append("\t}")
    out.append("\treturn errors;")
    out.append("}")
    out.append("")
    out.append("/**")
    out.append(f" * {r['key']}")
    out.append(f" * {desc}")
    out.append(f" * Owner team: {rng.choice(['core', 'growth', 'billing', 'platform'])}. Rate limit: {rng.choice([10, 50, 100, 500])} rpm.")
    out.append(" */")
    out.append("export async function handler(ctx: Ctx): Promise<Reply> {")
    for line in lines:
        out.append("\t" + line)
    out.append("}")
    return "\n".join(out) + "\n"


def build():
    routes = plan()
    files = {r["file"]: render(r) for r in routes}
    changed = sorted(r["key"] for r in routes if r["state"] not in ("ok", "public_ok"))
    expected = {
        "routes": {
            r["file"]: {"key": r["key"], "public": r["public"], "reply": expected_reply(r)} for r in routes
        },
        "changed": changed,
    }
    return files, expected


def main():
    files, expected = build()
    if "--expected" in sys.argv:
        print(json.dumps(expected, indent=1, sort_keys=True))
        return
    for path, text in files.items():
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)


if __name__ == "__main__":
    main()
