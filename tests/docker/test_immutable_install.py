"""Runtime smoke tests for Docker immutable install tree and install-method stamp.

Build the real image and verify at runtime:

  1. /opt/akramcode is not writable by the akramcode user (immutable install tree)
  2. A stale "docker" stamp in $AKRAMCODE_HOME is healed (removed) on boot

The hosted write-policy env (PYTHONDONTWRITEBYTECODE,
AKRAMCODE_WRITE_SAFE_ROOT, ...) is covered by
test_immutable_install_permissions.py.
"""
from __future__ import annotations

import pytest

from tests.docker.conftest import (
    docker_exec,
    docker_exec_sh,
    restart_container,
    start_container,
)


@pytest.mark.parametrize("uid", [10000, 23456])
def test_install_tree_not_writable_by_akramcode(
    built_image: str, container_name: str, uid: int,
) -> None:
    """The akramcode user must not be able to modify /opt/akramcode.

    The install tree (source, venv, TUI bundle, node_modules) must remain
    root-owned and non-writable so an agent session cannot self-modify
    the installation and brick the gateway.
    """
    start_container(built_image, container_name, f"AKRAMCODE_UID={uid}", f"AKRAMCODE_GID={uid}")
    identity = docker_exec(container_name, "id", "-u")
    assert identity.returncode == 0 and identity.stdout.strip() == str(uid)

    probe = docker_exec(container_name, "/opt/akramcode/.venv/bin/python", "-c", """
import os
from pathlib import Path
from akramcode_cli.config import detect_install_method
assert os.geteuid() != 0
code = Path('/opt/akramcode/.install_method')
home = Path('/opt/data/.install_method')
assert code.read_text().strip() == 'docker'
assert detect_install_method(Path('/opt/akramcode')) == 'docker'
assert not home.exists() or home.read_text().strip() != 'docker'
try:
    with code.open('a'):
        pass
except PermissionError:
    pass
else:
    raise AssertionError('runtime user can alter installation method')
assert code.read_text().strip() == 'docker'
for relative in ('pm-runtime/pm-runtime.json', 'tools/facts.json', 'manifest.json'):
    path = Path('/opt/akramcode') / relative
    assert path.stat().st_uid == 0, path
    assert path.read_bytes(), path
    assert not os.access(path, os.W_OK), path
    assert path.stat().st_mode & 0o022 == 0, path
for relative in ('.venv/.lock', 'pm-runtime/.lock'):
    path = Path('/opt/akramcode') / relative
    assert not path.exists() or not os.access(path, os.W_OK), path
""")
    assert probe.returncode == 0, probe.stdout + probe.stderr

    r = docker_exec_sh(
        container_name,
        # Try to create a file under /opt/akramcode as the akramcode user
        "touch /opt/akramcode/test_write 2>&1 && "
        "echo WRITE_SUCCEEDED || echo WRITE_FAILED",
        timeout=10,
    )
    assert "WRITE_FAILED" in r.stdout, (
        f"akramcode user can write to /opt/akramcode (install tree not immutable): "
        f"{r.stdout}"
    )

    # Also check a key subdirectory
    r = docker_exec_sh(
        container_name,
        "touch /opt/akramcode/.venv/test_write 2>&1 && "
        "echo WRITE_SUCCEEDED || echo WRITE_FAILED",
        timeout=10,
    )
    assert "WRITE_FAILED" in r.stdout, (
        f"akramcode user can write to /opt/akramcode/.venv: {r.stdout}"
    )






def test_stale_docker_stamp_in_home_is_healed_on_boot(
    built_image: str, container_name: str,
) -> None:
    """A stale 'docker' stamp left in $AKRAMCODE_HOME by an older image
    must be removed on boot so shared homes self-heal."""
    # Start container, write a stale stamp
    start_container(built_image, container_name)

    # Write a stale 'docker' stamp as root
    docker_exec(
        container_name, "sh", "-c",
        "printf 'docker\\n' > /opt/data/.install_method",
        user="root", timeout=5,
    )
    # Verify it exists
    r = docker_exec_sh(container_name, "cat /opt/data/.install_method", timeout=5)
    assert r.stdout.strip() == "docker"

    # Restart - stage2 should heal it
    restart_container(container_name)

    # The stale stamp must be gone
    r = docker_exec_sh(
        container_name,
        "test -f /opt/data/.install_method && "
        "cat /opt/data/.install_method || echo HEALED",
        timeout=10,
    )
    assert "HEALED" in r.stdout or r.stdout.strip() != "docker", (
        f"stale 'docker' stamp in $AKRAMCODE_HOME was not healed on boot: "
        f"{r.stdout}"
    )
