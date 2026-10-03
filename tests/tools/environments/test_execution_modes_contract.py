"""Contract tests for local execution and the OpenSandbox backend boundary."""

from tools.environments.local import LocalEnvironment


def test_local_mode_runs_in_checkout_and_keeps_files_and_cwd(tmp_path):
    """Local mode executes on the host and retains shell cwd between calls."""
    workdir = tmp_path / "checkout"
    workdir.mkdir()
    env = LocalEnvironment(cwd=str(workdir), timeout=10)
    try:
        first = env.execute("mkdir nested && cd nested && printf local > marker")
        second = env.execute("pwd && cat marker")

        assert first["returncode"] == 0
        assert second["returncode"] == 0
        assert second["output"].splitlines() == [str(workdir / "nested"), "local"]
        assert (workdir / "nested" / "marker").read_text() == "local"
    finally:
        env.cleanup()
