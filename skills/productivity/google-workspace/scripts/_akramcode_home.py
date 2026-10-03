"""Resolve AKRAMCODE_HOME for standalone skill scripts.

Skill scripts may run outside the AkramCode process (e.g. system Python,
nix env, CI) where ``akramcode_constants`` is not importable.  This module
provides the same ``get_akramcode_home()`` and ``display_akramcode_home()``
contracts as ``akramcode_constants`` without requiring it on ``sys.path``.

When ``akramcode_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``akramcode_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``AKRAMCODE_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from akramcode_constants import display_akramcode_home as display_akramcode_home
    from akramcode_constants import get_akramcode_home as get_akramcode_home
except (ModuleNotFoundError, ImportError):

    def get_akramcode_home() -> Path:
        """Return the AkramCode home directory (default: ~/.akramcode).

        Mirrors ``akramcode_constants.get_akramcode_home()``."""
        val = os.environ.get("AKRAMCODE_HOME", "").strip()
        return Path(val) if val else Path.home() / ".akramcode"

    def display_akramcode_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``akramcode_constants.display_akramcode_home()``."""
        home = get_akramcode_home()
        try:
            return "~/" + home.relative_to(Path.home()).as_posix()
        except ValueError:
            return str(home)
