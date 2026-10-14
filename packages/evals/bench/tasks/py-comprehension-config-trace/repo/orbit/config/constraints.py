"""Final clamps applied after all layers. Values are clamped, never rejected."""

# per-profile ceilings for the worker pool
MAX_WORKERS_BY_PROFILE = {"dev": 4, "staging": 12, "prod": 16}

# HTTP timeout bounds (seconds)
MIN_HTTP_TIMEOUT = {"prod": 25}
MAX_HTTP_TIMEOUT = 600

MAX_CACHE_TTL = 3600


def apply_constraints(config: dict, profile: str) -> dict:
    out = dict(config)
    ceiling = MAX_WORKERS_BY_PROFILE.get(profile)
    if ceiling is not None:
        out["workers.max"] = min(int(out["workers.max"]), ceiling)
    out["workers.max"] = max(1, int(out["workers.max"]))

    timeout = int(out["http.timeout_seconds"])
    timeout = max(timeout, MIN_HTTP_TIMEOUT.get(profile, 1))
    out["http.timeout_seconds"] = min(timeout, MAX_HTTP_TIMEOUT)

    out["cache.ttl_seconds"] = min(int(out["cache.ttl_seconds"]), MAX_CACHE_TTL)
    return out
