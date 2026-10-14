def check_interval(interval):
    """Raise ValueError if interval is not a (start, end) pair with start <= end."""
    if len(interval) != 2:
        raise ValueError(f"interval must have two items: {interval!r}")
    start, end = interval
    if start > end:
        raise ValueError(f"interval start > end: {interval!r}")
    return start, end
