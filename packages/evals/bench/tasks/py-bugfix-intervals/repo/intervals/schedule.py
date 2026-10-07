from .merge import merge_intervals


def free_slots(busy, day_start, day_end):
    """Return the free (start, end) gaps inside [day_start, day_end] given busy intervals."""
    slots = []
    cursor = day_start
    for start, end in merge_intervals(busy):
        if end <= day_start or start >= day_end:
            continue
        if start > cursor:
            slots.append((cursor, min(start, day_end)))
        cursor = max(cursor, end)
    if cursor < day_end:
        slots.append((cursor, day_end))
    return slots
