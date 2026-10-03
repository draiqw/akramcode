"""Regression for #68523 — one systemctl timeout must not abort fleet restarts.

On hosts with many profile-backed ``akramcode-gateway*.service`` units,
``akramcode update`` used to wrap the entire per-scope unit loop in a single
``except subprocess.TimeoutExpired``. A timeout on unit N skipped units
N+1…, leaving later gateways on pre-update in-memory modules while the
checkout on disk was already new (mixed-generation crashes).
"""

from __future__ import annotations

import subprocess

import pytest

from akramcode_cli.update_cmd import _for_each_systemd_gateway_unit, _service_unit_supports_graceful_sigusr1_restart, _warn_incomplete_gateway_fleet_restart


def _list_units_stdout(names: list[str]) -> str:
    return "\n".join(f"{name}.service loaded active running" for name in names)


class TestFleetRestartTimeoutIsolation:
    def test_timeout_on_middle_unit_continues_remaining_units(self):
        units = [
            "akramcode-gateway-xiaomo1",
            "akramcode-gateway-xiaomo2",
            "akramcode-gateway-xiaomo3",
            "akramcode-gateway-xiaomo4",
            "akramcode-gateway-xiaomo5",
            "akramcode-gateway-xiaomo6",
            "akramcode-gateway-xiaomo7",
            "akramcode-gateway",
        ]
        restarted: list[str] = []
        failed: list[str] = []
        timeout_cmds: list = []

        def process_unit(svc_name: str) -> None:
            if svc_name == "akramcode-gateway-xiaomo5":
                raise subprocess.TimeoutExpired(
                    cmd=["systemctl", "--user", "--no-ask-password", "restart", svc_name],
                    timeout=15,
                )
            restarted.append(svc_name)

        def on_unit_timeout(svc_name: str, exc: subprocess.TimeoutExpired) -> None:
            failed.append(svc_name)
            timeout_cmds.append(exc.cmd)

        _for_each_systemd_gateway_unit(
            _list_units_stdout(units),
            process_unit=process_unit,
            on_unit_timeout=on_unit_timeout,
        )

        assert failed == ["akramcode-gateway-xiaomo5"]
        assert restarted == [
            "akramcode-gateway-xiaomo1",
            "akramcode-gateway-xiaomo2",
            "akramcode-gateway-xiaomo3",
            "akramcode-gateway-xiaomo4",
            "akramcode-gateway-xiaomo6",
            "akramcode-gateway-xiaomo7",
            "akramcode-gateway",
        ]
        assert set(restarted) | set(failed) == set(units)
        assert timeout_cmds == [
            ["systemctl", "--user", "--no-ask-password", "restart", "akramcode-gateway-xiaomo5"]
        ]

    def test_non_gateway_units_in_list_output_are_ignored(self):
        seen: list[str] = []

        _for_each_systemd_gateway_unit(
            "\n".join(
                [
                    "ssh.service loaded active running",
                    "akramcode-gateway-coder.service loaded active running",
                    "not-a-service loaded active running",
                    "",
                ]
            ),
            process_unit=seen.append,
            on_unit_timeout=lambda *_: pytest.fail("unexpected timeout"),
        )

        assert seen == ["akramcode-gateway-coder"]

    def test_akramcode_serve_units_are_included(self):
        # #83438 — akramcode update restarted akramcode-gateway* units but left
        # akramcode-serve* (the Desktop app's backend) on stale pre-update code.
        seen: list[str] = []

        _for_each_systemd_gateway_unit(
            "\n".join(
                [
                    "ssh.service loaded active running",
                    "akramcode-serve.service loaded active running",
                    "akramcode-serve-work.service loaded active running",
                    "akramcode-gateway.service loaded active running",
                    "",
                ]
            ),
            process_unit=seen.append,
            on_unit_timeout=lambda *_: pytest.fail("unexpected timeout"),
        )

        assert seen == ["akramcode-serve", "akramcode-serve-work", "akramcode-gateway"]

    def test_akramcode_dashboard_units_are_included(self):
        # #125297 — the same blind spot for the systemd-supervised dashboard: the
        # unit pass skipped akramcode-dashboard*, so a successful update left the
        # dashboard on pre-update code with outcome "deferred" and nothing
        # restarted it. Reconciliation already credits akramcode-dashboard{,-<profile>}
        # unit restarts; the pass must produce one.
        seen: list[str] = []

        _for_each_systemd_gateway_unit(
            "\n".join(
                [
                    "ssh.service loaded active running",
                    "akramcode-dashboard.service loaded active running",
                    "akramcode-dashboard-work.service loaded active running",
                    "akramcode-serve.service loaded active running",
                    "",
                ]
            ),
            process_unit=seen.append,
            on_unit_timeout=lambda *_: pytest.fail("unexpected timeout"),
        )

        assert seen == ["akramcode-dashboard", "akramcode-dashboard-work", "akramcode-serve"]

    def test_akramcode_dashboard_near_prefix_is_rejected(self):
        # Same strict shape on the dashboard side: a bare
        # ``startswith("akramcode-dashboard")`` gate would also accept the
        # unrelated ``akramcode-dashboardd.service``.
        seen: list[str] = []

        _for_each_systemd_gateway_unit(
            _list_units_stdout(["akramcode-dashboardd", "akramcode-dashboard-work"]),
            process_unit=seen.append,
            on_unit_timeout=lambda *_: pytest.fail("unexpected timeout"),
        )

        assert seen == ["akramcode-dashboard-work"]

    def test_akramcode_server_near_prefix_is_rejected(self):
        # Review on #83595: a bare ``startswith("akramcode-serve")`` gate also
        # accepts the unrelated ``akramcode-server.service``. Only the exact
        # base unit or the hyphenated profile family should pass.
        seen: list[str] = []

        _for_each_systemd_gateway_unit(
            _list_units_stdout(["akramcode-server"]),
            process_unit=seen.append,
            on_unit_timeout=lambda *_: pytest.fail("unexpected timeout"),
        )

        assert seen == []

    def test_akramcode_gateway_near_prefix_is_rejected(self):
        # Same strict shape on the gateway side: profile units are
        # ``akramcode-gateway-<profile>``, so a hypothetical
        # ``akramcode-gatewayd.service`` must not enter the restart path.
        seen: list[str] = []

        _for_each_systemd_gateway_unit(
            _list_units_stdout(["akramcode-gatewayd", "akramcode-gateway-coder"]),
            process_unit=seen.append,
            on_unit_timeout=lambda *_: pytest.fail("unexpected timeout"),
        )

        assert seen == ["akramcode-gateway-coder"]


class TestGracefulSigusr1Eligibility:
    def test_gateway_units_are_eligible(self):
        assert _service_unit_supports_graceful_sigusr1_restart("akramcode-gateway")
        assert _service_unit_supports_graceful_sigusr1_restart(
            "akramcode-gateway-work"
        )

    def test_serve_units_are_not_eligible(self):
        # akramcode-serve doesn't run gateway/run.py, so it never installs the
        # SIGUSR1 handler — sending it the signal would just terminate the
        # process (the default action) instead of draining gracefully.
        assert not _service_unit_supports_graceful_sigusr1_restart("akramcode-serve")
        assert not _service_unit_supports_graceful_sigusr1_restart(
            "akramcode-serve-work"
        )

    def test_process_errors_other_than_timeout_still_propagate(self):
        def process_unit(_svc_name: str) -> None:
            raise RuntimeError("not a timeout")

        with pytest.raises(RuntimeError, match="not a timeout"):
            _for_each_systemd_gateway_unit(
                _list_units_stdout(["akramcode-gateway"]),
                process_unit=process_unit,
                on_unit_timeout=lambda *_: pytest.fail("timeout handler must not run"),
            )


class TestIncompleteFleetRestartWarning:
    def test_warns_with_exact_unrestarted_units(self, capsys):
        _warn_incomplete_gateway_fleet_restart(
            ["akramcode-gateway-xiaomo5", "akramcode-gateway-xiaomo6", "akramcode-gateway-xiaomo5"]
        )
        out = capsys.readouterr().out
        assert "Update incomplete" in out
        assert out.count("akramcode-gateway-xiaomo5") == 1
        assert "akramcode-gateway-xiaomo6" in out
        assert "pre-update code" in out

