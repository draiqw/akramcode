"""Built-in defaults. Keys are dotted paths."""

BASE_DEFAULTS: dict[str, object] = {
    "http.timeout_seconds": 30,
    "http.port": 8000,
    "cache.ttl_seconds": 300,
    "cache.backend": "memory",
    "workers.max": 4,
    "workers.queue": "default",
    "log.level": "info",
    "feature.beta_ui": False,
    "plugins.enabled": ["metrics"],
}
