"""Generate ~50 service modules that use the deprecated app.legacy API (cwd = workspace).

`python3 setup.py --expected` prints hidden expectations instead.
The reference solution imports this file and renders the migrated modules with `render(spec, migrated=True)`.
"""

import hashlib
import json
import os
import random
import sys

DOMAINS = ["billing", "orders", "inventory", "shipping", "users", "catalog", "reports", "search", "payments", "notify"]
PER_DOMAIN = 5
ALREADY_MIGRATED = {"catalog_02", "orders_04", "search_01", "users_03"}
STYLES = ["module", "module", "alias", "names"]
PATHS = ["items", "summary", "batch", "status", "export", "history", "pending", "audit", "metrics", "config"]


def plan():
    rng = random.Random(9001)
    modules = []
    for domain in DOMAINS:
        for i in range(1, PER_DOMAIN + 1):
            name = f"{domain}_{i:02d}"
            style = rng.choice(STYLES)
            sites = []
            for k in range(rng.randint(1, 4)):
                site = {
                    "path": f"{rng.choice(PATHS)}/{k}",
                    "url_kind": rng.choice(["concat", "fstring"]),
                    "retries": rng.choice([None, None, 0, 1, 2, 3, 5, "var"]),
                    "positional": False,
                    "timeout": rng.choice([None, None, 2, 5, 10, 30, "var"]),
                    "timeout_kind": rng.choice(["inline", "inline", "local"]),
                    "multiline": rng.random() < 0.35,
                }
                if isinstance(site["retries"], int) and site["retries"] > 0 and rng.random() < 0.3:
                    site["positional"] = True
                sites.append(site)
            modules.append(
                {
                    "name": name,
                    "domain": domain,
                    "style": "migrated" if name in ALREADY_MIGRATED else style,
                    "sites": sites,
                    "max_retries": rng.randint(1, 4),
                    "timeout_s": rng.choice([3, 7, 15]),
                    "region": rng.choice(["eu", "us", "ap"]),
                    "seed": rng.randint(1, 10**6),
                }
            )
    return modules


def _prefix(style):
    return {"module": "legacy.", "alias": "lg.", "names": ""}[style]


def _url(site):
    if site["url_kind"] == "concat":
        return f'self.base_url + "/{site["path"]}"'
    return f'f"{{self.base_url}}/{site["path"]}/{{self.region}}"'


def _url_value(mod, site):
    base = f"https://{mod['domain']}.internal"
    if site["url_kind"] == "concat":
        return f"{base}/{site['path']}"
    return f"{base}/{site['path']}/{mod['region']}"


def _call_lines(mod, site, migrated):
    """Return (pre_lines, call_expr_lines) for one call site."""
    p = _prefix(mod["style"]) if not migrated else None
    pre = []
    args = [_url(site)]
    r = site["retries"]
    r_expr = "self.max_retries" if r == "var" else (str(r) if r is not None else None)
    if r_expr is not None:
        if migrated:
            if r != 0:
                args.append(f"retry=Retry({r_expr})")
        elif site["positional"]:
            args.append(r_expr)
        else:
            args.append(f"retries={r_expr}")
    t = site["timeout"]
    if t is not None:
        t_expr = "self.timeout_s" if t == "var" else str(t)
        wrapped = t_expr if migrated else f"{p}Timeout({t_expr})"
        if site["timeout_kind"] == "local":
            pre.append(f"t = {wrapped}")
            args.append("timeout=t")
        else:
            args.append(f"timeout={wrapped}")
    fn = "client.get" if migrated else f"{p}fetch"
    if site["multiline"]:
        lines = [f"resp = {fn}("] + [f"    {a}," for a in args] + [")"]
    else:
        lines = [f"resp = {fn}({', '.join(args)})"]
    return pre, lines


def _expected_call(mod, site):
    r = site["retries"]
    attempts = mod["max_retries"] if r == "var" else (r if r else None)
    t = site["timeout"]
    timeout = mod["timeout_s"] if t == "var" else t
    return [_url_value(mod, site), attempts, timeout]


def _imports(mod, migrated):
    if migrated or mod["style"] == "migrated":
        needs_retry = any(s["retries"] not in (None, 0) for s in mod["sites"])
        return "from app.client import Retry, client" if needs_retry else "from app.client import client"
    if mod["style"] == "module":
        return "from app import legacy"
    if mod["style"] == "alias":
        return "from app import legacy as lg"
    needs_timeout = any(s["timeout"] is not None for s in mod["sites"])
    return "from app.legacy import Timeout, fetch" if needs_timeout else "from app.legacy import fetch"


FILLER_METHODS = [
    '''    def normalize_key(self, key):
        """Lower-case a key and strip separators so cache lookups are stable."""
        cleaned = []
        for ch in key.strip().lower():
            if ch.isalnum():
                cleaned.append(ch)
            elif ch in "-_ ." and cleaned and cleaned[-1] != "_":
                cleaned.append("_")
        return "".join(cleaned).strip("_")
''',
    '''    def summarize(self, rows):
        """Return count, total and max of the numeric `amount` field."""
        total = 0
        biggest = None
        for row in rows:
            amount = row.get("amount", 0)
            total += amount
            if biggest is None or amount > biggest:
                biggest = amount
        return {"count": len(rows), "total": total, "max": biggest}
''',
    '''    def page(self, items, size):
        """Split items into pages of `size` (last page may be short)."""
        if size <= 0:
            raise ValueError("size must be positive")
        return [items[i : i + size] for i in range(0, len(items), size)]
''',
    '''    def merge_headers(self, *layers):
        """Merge header dicts; later layers win, keys are case-insensitive."""
        merged = {}
        for layer in layers:
            for key, value in layer.items():
                merged[key.lower()] = value
        return merged
''',
    '''    def backoff_schedule(self, attempts, base_ms=100):
        """Exponential backoff delays in milliseconds, capped at 5 seconds."""
        return [min(5000, base_ms * (2**i)) for i in range(attempts)]
''',
    '''    def parse_status(self, payload):
        """Map a response payload to one of ok / retry / fail."""
        status = payload.get("status", 0)
        if 200 <= status < 300:
            return "ok"
        if status in (429, 502, 503, 504):
            return "retry"
        return "fail"
''',
]


def render(mod, migrated=False):
    migrated = migrated or mod["style"] == "migrated"
    cls = "".join(part.capitalize() for part in mod["name"].split("_")[:1]) + "Service" + mod["name"].split("_")[1]
    rng = random.Random(mod["seed"])
    filler = rng.sample(FILLER_METHODS, 3)
    out = [
        f'"""{mod["domain"].capitalize()} service module {mod["name"]}."""',
        "",
        _imports(mod, migrated),
        "",
        "",
        f"class {cls}:",
        f'    """Talks to the {mod["domain"]} backend."""',
        "",
        "    def __init__(self):",
        f'        self.base_url = "https://{mod["domain"]}.internal"',
        f'        self.region = "{mod["region"]}"',
        f"        self.max_retries = {mod['max_retries']}",
        f"        self.timeout_s = {mod['timeout_s']}",
        "",
    ]
    out.extend(filler[0].rstrip("\n").split("\n"))
    out.append("")
    for k, site in enumerate(mod["sites"]):
        pre, call = _call_lines(mod, site, migrated)
        out.append(f"    def request_{k}(self):")
        out.append(f'        """Fetch {site["path"]} from the backend."""')
        for line in pre + call:
            out.append("        " + line)
        out.append('        return resp["body"]')
        out.append("")
        if k == 0:
            out.extend(filler[1].rstrip("\n").split("\n"))
            out.append("")
    out.extend(filler[2].rstrip("\n").split("\n"))
    out.append("")
    out.append("")
    out.append("def run():")
    out.append('    """Exercise every request once; used by the smoke tests."""')
    out.append(f"    svc = {cls}()")
    out.append(f"    return [{', '.join(f'svc.request_{k}()' for k in range(len(mod['sites'])))}]")
    return "\n".join(out) + "\n"


DISTRACTORS = {
    "app/modules/docs_helpers.py": '''"""Helpers that render migration documentation for the developer portal."""

# NOTE: legacy.fetch(url, retries=N) used to be the only way to call backends.
# It was replaced by client.get(url, retry=Retry(N)); see MIGRATION.md.

HELP_TEXT = """Old style:
    resp = legacy.fetch(url, retries=3, timeout=legacy.Timeout(5))
New style:
    resp = client.get(url, retry=Retry(3), timeout=5)
"""


def describe_legacy():
    """Explain the deprecated API in one line."""
    return "legacy.fetch(url, retries=N) and legacy.Timeout(seconds) are deprecated"


def run():
    return [HELP_TEXT.count("fetch"), describe_legacy()]
''',
    "app/modules/cache_utils.py": '''"""In-process cache helpers. Unrelated to HTTP."""

_CACHE = {"alpha": 1, "beta": 2}


def fetch(key, default=None, retries=0):
    """Look up `key` in the in-process cache; `retries` re-reads after a miss (always misses here)."""
    for _ in range(retries + 1):
        if key in _CACHE:
            return _CACHE[key]
    return default


def warm(keys):
    """Return the cached values for keys, using fetch with one re-read."""
    return [fetch(k, default=-1, retries=1) for k in keys]


def run():
    return warm(["alpha", "gamma", "beta"])
''',
    "app/modules/changelog_notes.py": '''"""Release notes shown in the admin UI."""

NOTES = [
    "2.0: removed retries= from legacy.fetch callers in billing",
    "2.1: Timeout objects (legacy.Timeout) replaced by plain seconds",
    "2.2: from app import legacy is no longer allowed in app/modules",
]


def latest():
    return NOTES[-1]


def run():
    return [len(NOTES), latest()]
''',
}


def build():
    files = {"app/modules/__init__.py": ""}
    expected = {"modules": {}, "distractors": {}, "migrated_modules": [], "call_sites": 0}
    for mod in plan():
        path = f"app/modules/{mod['name']}.py"
        files[path] = render(mod)
        expected["modules"][mod["name"]] = {
            "calls": [_expected_call(mod, s) for s in mod["sites"]],
            "result": ["ok:" + _url_value(mod, s) for s in mod["sites"]],
        }
        if mod["style"] != "migrated":
            expected["migrated_modules"].append(path)
            expected["call_sites"] += len(mod["sites"])
    for path, text in DISTRACTORS.items():
        files[path] = text
        expected["distractors"][path] = hashlib.sha256(text.encode("utf-8")).hexdigest()
    expected["migrated_modules"].sort()
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
