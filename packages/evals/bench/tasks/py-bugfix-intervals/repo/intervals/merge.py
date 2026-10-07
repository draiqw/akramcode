from .validate import check_interval


def merge_intervals(intervals):
    """Merge overlapping intervals and return them as a list of (start, end) tuples."""
    if not intervals:
        return []
    for interval in intervals:
        check_interval(interval)
    result = [list(intervals[0])]
    for start, end in intervals[1:]:
        last = result[-1]
        if start < last[1]:
            last[1] = max(last[1], end)
        else:
            result.append([start, end])
    return [tuple(item) for item in result]
