MISSING = object()


def resolve(path, context):
    """Resolve a dotted path like "user.name" against nested dicts/objects.

    Returns MISSING when any segment cannot be found.
    """
    value = context
    for part in path.split("."):
        if isinstance(value, dict):
            if part not in value:
                return MISSING
            value = value[part]
        elif hasattr(value, part):
            value = getattr(value, part)
        else:
            return MISSING
    return value
