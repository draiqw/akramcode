from .app import App


def describe(app: App) -> str:
    c = app.config
    return (
        f"port={c['http.port']} timeout={c['http.timeout_seconds']}s "
        f"workers={c['workers.max']} cache={c['cache.backend']}:{c['cache.ttl_seconds']}s"
    )
