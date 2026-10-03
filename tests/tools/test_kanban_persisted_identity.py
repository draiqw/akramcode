"""Board identity follows the profile a kanban call runs FOR, never the generic ``"worker"``.

``kanban_comment`` / ``kanban_create`` used to read ``os.environ["AKRAMCODE_PROFILE"]`` and fall back to
``"worker"``. A multiplexed per-profile cron tick binds the profile as a ``AKRAMCODE_HOME`` override and
never mirrors it into ``os.environ``, so every card comment a served profile's turn wrote was
authored ``"worker"`` (#119859). ``akramcode_cli.profiles.current_profile_name`` is the one resolver:
the bound override first, the dispatcher's ``AKRAMCODE_PROFILE`` pin only outside an override, the
process home last. Identity never comes from tool args (#19713).
"""
from __future__ import annotations

import json

import pytest

from akramcode_constants import reset_akramcode_home_override, set_akramcode_home_override


@pytest.fixture
def board_env(tmp_path, monkeypatch):
    """A root-profile board with two served profiles beside it and no env pin at all."""
    root = tmp_path / "hroot"
    for name in ("alpha", "beta"):
        (root / "profiles" / name).mkdir(parents=True)
    monkeypatch.setenv("AKRAMCODE_HOME", str(root))
    for var in ("AKRAMCODE_PROFILE", "AKRAMCODE_PROFILE_NAME", "AKRAMCODE_SESSION_ID", "AKRAMCODE_KANBAN_DB",
                "AKRAMCODE_KANBAN_HOME", "AKRAMCODE_KANBAN_BOARD", "AKRAMCODE_KANBAN_WORKSPACES_ROOT"):
        monkeypatch.delenv(var, raising=False)

    from akramcode_cli import kanban_db as kb
    from akramcode_cli import kanban_db_connect as kbc
    kb._INITIALIZED_PATHS.clear()
    kb.init_db()
    conn = kbc.connect()
    try:
        tid = kb.create_task(conn, title="identity-test", assignee="alpha")
        kb.claim_task(conn, tid)
    finally:
        conn.close()
    monkeypatch.setenv("AKRAMCODE_KANBAN_TASK", tid)
    return root, tid


def _last_comment_author(tid: str) -> str:
    from akramcode_cli import kanban_db as kb
    from akramcode_cli import kanban_db_connect as kbc
    conn = kbc.connect()
    try:
        return kb.list_comments(conn, tid)[-1].author
    finally:
        conn.close()


def _created_by(tid: str) -> str:
    from akramcode_cli import kanban_db as kb
    from akramcode_cli import kanban_db_connect as kbc
    conn = kbc.connect()
    try:
        return kb.get_task(conn, tid).created_by
    finally:
        conn.close()


def test_a_served_profiles_tick_authors_board_records_as_that_profile(board_env, monkeypatch):
    """A→B→A under the home override with ``AKRAMCODE_PROFILE`` unset (the multiplexed tick shape):
    comment author and ``created_by`` are the ticking profile's, never ``"worker"``. A launch-side
    ``AKRAMCODE_PROFILE`` pin does not re-label a served profile's writes."""
    from tools import kanban_tools as kt
    root, tid = board_env
    monkeypatch.setenv("AKRAMCODE_PROFILE", "launch-host")  # the launch process's own pin

    for name in ("alpha", "beta", "alpha"):
        token = set_akramcode_home_override(root / "profiles" / name)
        try:
            out = json.loads(kt._handle_comment({"task_id": tid, "body": f"from {name}"}))
            assert out["ok"], out
            assert _last_comment_author(tid) == name
            child = json.loads(kt._handle_create(
                {"title": f"{name} child", "assignee": "peer", "parents": [tid]}))
            assert child["ok"], child
            assert _created_by(child["task_id"]) == name
        finally:
            reset_akramcode_home_override(token)


def test_a_dispatched_worker_keeps_its_pinned_identity_and_an_unnamed_caller_stays_generic(
        board_env, monkeypatch):
    """Control: no override → the dispatcher's ``AKRAMCODE_PROFILE`` pin wins over the process home;
    absence: nothing names a profile and the home is not a profile → ``"worker"``."""
    from tools import kanban_tools as kt
    root, tid = board_env

    monkeypatch.setenv("AKRAMCODE_PROFILE", "pinned-bot")
    assert json.loads(kt._handle_comment({"task_id": tid, "body": "from env"}))["ok"]
    assert _last_comment_author(tid) == "pinned-bot"

    monkeypatch.delenv("AKRAMCODE_PROFILE")
    import akramcode_cli.profiles as profiles
    monkeypatch.setattr(profiles, "get_active_profile_name", lambda: "")
    assert json.loads(kt._handle_comment({"task_id": tid, "body": "anon"}))["ok"]
    assert _last_comment_author(tid) == "worker"
