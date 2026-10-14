"""Merging helpers for flat dotted-key config dicts."""


def merge_layer(target: dict, layer: dict) -> set[str]:
    """Applies `layer` onto `target`. Keys ending in '+' append to list values.

    Returns the set of keys that were written.
    """
    written: set[str] = set()
    for key, value in layer.items():
        if key.endswith("+"):
            base = key[:-1]
            current = list(target.get(base, []))
            for item in value:
                if item not in current:
                    current.append(item)
            target[base] = current
            written.add(base)
        else:
            target[key] = value
            written.add(key)
    return written
