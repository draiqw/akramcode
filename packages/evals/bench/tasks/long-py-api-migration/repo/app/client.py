"""The new HTTP client. Use the shared `client` instance: `from app.client import client, Retry`."""


class Retry:
    """Retry policy: up to `attempts` extra attempts after the first one."""

    def __init__(self, attempts):
        if not isinstance(attempts, int) or attempts < 1:
            raise ValueError("Retry(attempts) needs a positive integer")
        self.attempts = attempts

    def __repr__(self):
        return f"Retry({self.attempts})"


class Client:
    def __init__(self):
        # Every request is recorded here as (url, retry_attempts_or_None, timeout_seconds_or_None).
        self.calls = []

    def get(self, url, retry=None, timeout=None):
        """GET `url`. `retry` is a Retry or None, `timeout` is a number of seconds or None."""
        if retry is not None and not isinstance(retry, Retry):
            raise TypeError("retry must be a Retry instance")
        if timeout is not None and (isinstance(timeout, bool) or not isinstance(timeout, (int, float))):
            raise TypeError("timeout must be a number of seconds")
        self.calls.append((url, retry.attempts if retry is not None else None, timeout))
        return {"url": url, "status": 200, "body": "ok:" + url}


client = Client()
