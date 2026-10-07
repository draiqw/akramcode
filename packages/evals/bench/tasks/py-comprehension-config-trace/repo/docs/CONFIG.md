# Configuration

> Last updated for orbit 0.3. Some details may have changed since.

Layers, lowest to highest priority:

1. Built-in defaults (`orbit/config/defaults.py`)
2. Profile files (`orbit/config/profiles/<name>.py`)
3. Plugin defaults
4. Environment variables (`ORBIT_<SECTION>_<KEY>`)

Constraints are checked at startup and raise an error when violated.

Environment examples:

- `ORBIT_HTTP_TIMEOUT=90` sets the HTTP timeout in seconds.
- `ORBIT_CACHE_TTL=600` sets the cache TTL in seconds.
