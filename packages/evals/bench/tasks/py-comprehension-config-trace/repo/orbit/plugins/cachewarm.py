from .base import Plugin


class CacheWarmPlugin(Plugin):
    name = "cachewarm"

    def contribute_defaults(self) -> dict:
        return {"cache.ttl_seconds": 900, "cachewarm.interval": 60}
