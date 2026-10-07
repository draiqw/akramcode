from .audit import AuditPlugin
from .base import Plugin
from .cachewarm import CacheWarmPlugin
from .metrics import MetricsPlugin
from .ratelimit import RateLimitPlugin

# Registry order matters: later plugins override earlier plugin defaults.
REGISTRY: list[type[Plugin]] = [MetricsPlugin, RateLimitPlugin, CacheWarmPlugin, AuditPlugin]


def enabled_plugins(names: list[str]) -> list[Plugin]:
    wanted = set(names)
    return [cls() for cls in REGISTRY if cls.name in wanted]
