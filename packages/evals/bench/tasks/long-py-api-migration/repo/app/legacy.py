"""Deprecated HTTP helpers. Do not use in new code; see MIGRATION.md."""

import warnings

# Every call is recorded here (url, retries, timeout_seconds) for diagnostics.
calls = []


class Timeout:
    """Deprecated timeout wrapper. The new client takes plain seconds instead."""

    def __init__(self, seconds):
        self.seconds = seconds

    def __repr__(self):
        return f"Timeout({self.seconds!r})"


def fetch(url, retries=0, timeout=None):
    """Deprecated: GET `url`, retrying up to `retries` extra times."""
    warnings.warn("app.legacy.fetch is deprecated, use app.client.client.get", DeprecationWarning, stacklevel=2)
    if timeout is not None and not isinstance(timeout, Timeout):
        raise TypeError("legacy.fetch expects timeout=Timeout(seconds)")
    calls.append((url, retries, timeout.seconds if timeout is not None else None))
    return {"url": url, "status": 200, "body": "ok:" + url}
