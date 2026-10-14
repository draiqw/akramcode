from .base import Plugin


class RateLimitPlugin(Plugin):
    name = "ratelimit"

    def contribute_defaults(self) -> dict:
        return {"http.timeout_seconds": 20, "workers.max": 6, "ratelimit.rps": 100}
