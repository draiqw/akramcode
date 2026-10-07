class Plugin:
    name = "base"

    def contribute_defaults(self) -> dict:
        return {}

    def on_start(self, app) -> None:
        pass
