"""Environment variable layer.

Variables use the form ORBIT_<SECTION>__<KEY> (double underscore) and map to
the dotted key `<section>.<key>` in lower case. A few aliases are supported for
convenience; legacy single-underscore names are ignored.
"""

from typing import Callable, Mapping

PREFIX = "ORBIT_"

# alias -> (dotted key, converter)
ALIASES: dict[str, tuple[str, Callable[[str], object]]] = {
    "ORBIT_CACHE_TTL_MIN": ("cache.ttl_seconds", lambda v: int(v) * 60),
    "ORBIT_PORT": ("http.port", int),
}

# Old names from orbit < 0.4. They are ignored (with a warning) since 0.4.
LEGACY_IGNORED = {"ORBIT_HTTP_TIMEOUT", "ORBIT_CACHE_TTL", "ORBIT_WORKERS"}


def _coerce(value: str) -> object:
    lowered = value.lower()
    if lowered in ("true", "false"):
        return lowered == "true"
    try:
        return int(value)
    except ValueError:
        return value


def env_layer(environ: Mapping[str, str], warn: Callable[[str], None] = lambda _m: None) -> dict:
    layer: dict[str, object] = {}
    for name, raw in sorted(environ.items()):
        if not name.startswith(PREFIX):
            continue
        if name in LEGACY_IGNORED:
            warn(f"ignoring legacy variable {name}")
            continue
        if name in ALIASES:
            key, convert = ALIASES[name]
            layer[key] = convert(raw)
            continue
        rest = name[len(PREFIX):]
        if "__" not in rest:
            warn(f"ignoring unrecognized variable {name}")
            continue
        section, key = rest.split("__", 1)
        layer[f"{section.lower()}.{key.lower()}"] = _coerce(raw)
    return layer
