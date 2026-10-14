import time


def retry(max_attempts=3, base_delay=0.1, factor=2.0, max_delay=None, exceptions=(Exception,), sleep=None):
    """Decorator factory that retries a function when it raises.

    Usage::

        @retry(max_attempts=4, base_delay=0.5, exceptions=(TimeoutError,))
        def fetch(): ...

    Spec:

    * ``retry(...)`` validates its arguments immediately (when called, before decorating):
      ``max_attempts`` must be an int >= 1, ``base_delay`` must be >= 0, ``factor`` must be >= 1,
      and ``max_delay`` must be None or >= 0. Otherwise it raises ValueError.
    * ``exceptions`` is an exception class or a tuple of classes. Only exceptions that are
      instances of it are retried; any other exception propagates immediately, without sleeping
      and without further attempts.
    * The wrapped function is called at most ``max_attempts`` times in total, with the same
      arguments each time. The first successful call's return value is returned.
    * Before the k-th retry (k = 1 for the second call, 2 for the third, ...) the decorator calls
      ``sleep(delay)`` exactly once with ``delay = base_delay * factor ** (k - 1)``, capped at
      ``max_delay`` when ``max_delay`` is not None. There is no sleep before the first call and no
      sleep after the final failed attempt.
    * ``sleep`` defaults to ``time.sleep`` when None. It is looked up when the decorated function
      is called, so tests may pass a fake.
    * When all attempts fail, the exception raised by the last attempt is re-raised (the same
      exception object).
    * The wrapper preserves the wrapped function's ``__name__`` and ``__doc__`` (functools.wraps)
      and exposes ``wrapper.last_attempts``: the number of calls made during the most recent
      invocation (0 before the first invocation).
    """
    raise NotImplementedError("retry is not implemented yet")


def _default_sleep(seconds):
    time.sleep(seconds)
