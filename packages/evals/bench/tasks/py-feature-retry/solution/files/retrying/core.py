import functools
import time


def retry(max_attempts=3, base_delay=0.1, factor=2.0, max_delay=None, exceptions=(Exception,), sleep=None):
    """Decorator factory that retries a function when it raises (see tests for the spec)."""
    if not isinstance(max_attempts, int) or isinstance(max_attempts, bool) or max_attempts < 1:
        raise ValueError("max_attempts must be an int >= 1")
    if base_delay < 0:
        raise ValueError("base_delay must be >= 0")
    if factor < 1:
        raise ValueError("factor must be >= 1")
    if max_delay is not None and max_delay < 0:
        raise ValueError("max_delay must be None or >= 0")

    def decorate(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            do_sleep = sleep if sleep is not None else time.sleep
            wrapper.last_attempts = 0
            for attempt in range(1, max_attempts + 1):
                wrapper.last_attempts = attempt
                try:
                    return fn(*args, **kwargs)
                except exceptions:
                    if attempt == max_attempts:
                        raise
                    delay = base_delay * factor ** (attempt - 1)
                    if max_delay is not None:
                        delay = min(delay, max_delay)
                    do_sleep(delay)

        wrapper.last_attempts = 0
        return wrapper

    return decorate
