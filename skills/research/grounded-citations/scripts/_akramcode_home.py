"""Resolve AKRAMCODE_HOME for standalone skill scripts.

Skill scripts may run outside the AkramCode process (system Python, nix env,
CI) where ``akramcode_constants`` is not importable.  This module provides the
same ``get_akramcode_home()`` contract without requiring it on ``sys.path``.

When ``akramcode_constants`` IS available it is used directly so profile
resolution and any future enhancements are picked up automatically.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from akramcode_constants import get_akramcode_home as get_akramcode_home
except (ModuleNotFoundError, ImportError):

    def get_akramcode_home() -> Path:
        """Return the AkramCode home directory (default: ``~/.akramcode``)."""
        val = os.environ.get("AKRAMCODE_HOME", "").strip()
        return Path(val) if val else Path.home() / ".akramcode"
