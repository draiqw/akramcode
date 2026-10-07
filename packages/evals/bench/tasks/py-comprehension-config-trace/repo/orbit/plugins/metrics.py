from .base import Plugin


class MetricsPlugin(Plugin):
    name = "metrics"

    def contribute_defaults(self) -> dict:
        # scraping needs a longer keep-alive window
        return {"http.timeout_seconds": 45, "metrics.port": 9100}
