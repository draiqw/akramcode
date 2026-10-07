from .validate import check_interval


def merge_intervals(intervals):
    """Merge overlapping or touching intervals and return them as a sorted list of (start, end) tuples."""
    if not intervals:
        return []
    checked = [check_interval(interval) for interval in intervals]
    ordered = sorted(checked)
    result = [list(ordered[0])]
    for start, end in ordered[1:]:
        last = result[-1]
        if start <= last[1]:
            last[1] = max(last[1], end)
        else:
            result.append([start, end])
    return [tuple(item) for item in result]
