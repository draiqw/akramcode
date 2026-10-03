"""Behavior contracts for the akramcode identity and legacy-home migration."""

from pathlib import Path

import akramcode_constants as constants


def test_akramcode_home_environment_variable_is_primary(monkeypatch, tmp_path):
    target = tmp_path / ".akramcode"
    monkeypatch.delenv("AKRAMCODE_HOME", raising=False)
    monkeypatch.setenv("AKRAMCODE_HOME", str(target))

    assert constants.get_process_akramcode_home() == target


def test_migrate_legacy_home_moves_data_once(tmp_path):
    legacy = tmp_path / ".akramcode"
    current = tmp_path / ".akramcode"
    legacy.mkdir()
    (legacy / "config.yaml").write_text("model: test\n")

    assert constants.migrate_legacy_home(current=current, legacy=legacy) is True
    assert (current / "config.yaml").read_text() == "model: test\n"
    assert not legacy.exists()
    assert constants.migrate_legacy_home(current=current, legacy=legacy) is False


def test_shell_installer_uses_akramcode_home_by_default():
    installer = (Path(__file__).parents[1] / "scripts/install.sh").read_text()

    assert "$HOME/.akramcode" in installer
    assert "INSTALL_DIR=\"${INSTALL_DIR:-$AKRAMCODE_HOME/akramcode}\"" in installer
