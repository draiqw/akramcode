"""Service wiring."""

import os

from .config import load_config
from .config.envfile import read_env_file
from .plugins import enabled_plugins


class App:
    def __init__(self, config: dict):
        self.config = config
        self.plugins = enabled_plugins(config["plugins.enabled"])

    def start(self) -> None:
        for plugin in self.plugins:
            plugin.on_start(self)


def create_app(profile: str | None = None) -> App:
    profile = profile or os.environ.get("ORBIT_PROFILE", "dev")
    env_path = os.path.join("deploy", f"{profile}.env")
    environ = dict(os.environ)
    if profile == "dev" and os.path.exists(env_path):
        # only local development reads the env file directly; in other
        # environments the orchestrator injects it as process environment
        environ.update(read_env_file(env_path))
    return App(load_config(profile, environ))
