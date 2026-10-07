import importlib


def profile_chain(name: str) -> list[dict]:
    """Returns profile layers from the most basic ancestor to `name` itself."""
    chain: list[dict] = []
    seen: set[str] = set()
    current: str | None = name
    while current is not None:
        if current in seen:
            raise ValueError(f"profile inheritance cycle at {current}")
        seen.add(current)
        module = importlib.import_module(f"{__name__}.{current}")
        chain.append(dict(module.SETTINGS))
        current = getattr(module, "INHERITS", None)
    chain.reverse()
    return chain
