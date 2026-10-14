"""Assembles the effective configuration.

Order of application:
  1. BASE_DEFAULTS
  2. profile chain (ancestors first)
  3. defaults contributed by enabled plugins, in registry order; a plugin value
     never overrides a key that a profile set explicitly
  4. environment variables
  5. constraints (clamping)
"""

from typing import Callable, Mapping

from ..plugins import enabled_plugins
from .constraints import apply_constraints
from .defaults import BASE_DEFAULTS
from .env import env_layer
from .merge import merge_layer
from .profiles import profile_chain


def load_config(
    profile: str,
    environ: Mapping[str, str],
    warn: Callable[[str], None] = lambda _m: None,
) -> dict:
    config: dict[str, object] = dict(BASE_DEFAULTS)
    config["plugins.enabled"] = list(BASE_DEFAULTS["plugins.enabled"])

    profile_keys: set[str] = set()
    for layer in profile_chain(profile):
        profile_keys |= merge_layer(config, layer)

    for plugin in enabled_plugins(config["plugins.enabled"]):
        for key, value in plugin.contribute_defaults().items():
            if key in profile_keys:
                continue
            config[key] = value

    merge_layer(config, env_layer(environ, warn))
    return apply_constraints(config, profile)
