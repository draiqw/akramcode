"""Regression contracts for the akram-code release and install defaults."""

from pathlib import Path


ROOT = Path(__file__).parents[2]


def test_installers_default_to_akram_code_and_allow_override():
    shell = (ROOT / "scripts/install.sh").read_text()

    assert "https://github.com/draiqw/akram-code.git" in shell
    assert "AKRAMCODE_REPO_URL" in shell
    assert "NousResearch/akramcode-agent.git" not in shell


def test_release_workflow_checks_tag_tests_and_publishes_release():
    workflow = (ROOT / ".github/workflows/akram-release.yml").read_text()

    assert "tags:" in workflow
    assert "'v*'" in workflow
    assert "repository: draiqw/akram-code" in workflow
    assert "ref: ${{ steps.tag.outputs.value }}" in workflow
    assert "scripts/run_tests.sh tests/scripts/" in workflow
    assert "gh release create" in workflow
    assert "contents: write" in workflow


def test_update_and_release_links_use_akram_code():
    updater = (ROOT / "akramcode_cli/update_cmd_git.py").read_text()
    banner = (ROOT / "akramcode_cli/banner.py").read_text()
    release = (ROOT / "scripts/release.py").read_text()

    for source in (updater, banner, release):
        assert "github.com/draiqw/akram-code" in source

    assert not (ROOT / ".github/workflows/sync-upstream.yml").exists()
