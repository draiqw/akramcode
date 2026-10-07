import json

from .core import retry


class TransientError(Exception):
    """A network error worth retrying."""


@retry(max_attempts=3, base_delay=0.2, exceptions=(TransientError,))
def fetch_config(transport, path):
    """Fetch a JSON config document through `transport` (a callable returning text)."""
    return json.loads(transport(path))
