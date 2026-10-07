from .base import Plugin


class AuditPlugin(Plugin):
    name = "audit"

    def contribute_defaults(self) -> dict:
        return {"http.timeout_seconds": 10, "workers.max": 1, "audit.sink": "stdout"}
