"""Alibaba OpenSandbox terminal backend.

The optional ``opensandbox`` SDK is imported only when this backend is created.
The server itself is an external service; this module never starts Docker or
pretends to execute commands when the SDK or server is unavailable.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import queue
import shlex
import threading
import uuid
from datetime import timedelta
from typing import Any

from tools.environments.base import BaseEnvironment, EnvironmentConnectionError
from tools.environments.remote_common import ensure_lazy_dep

logger = logging.getLogger(__name__)

_END_OF_OUTPUT = object()


def _load_sdk():
    ensure_lazy_dep("opensandbox")
    try:
        from opensandbox.config import ConnectionConfig
        from opensandbox.sandbox import Sandbox
    except ImportError as exc:
        raise ImportError(
            "OpenSandbox terminal backend requires the optional 'opensandbox' "
            "Python SDK. Install the SDK in AkramCode's managed environment "
            "and retry."
        ) from exc
    return ConnectionConfig, Sandbox


def _memory_limit(value: str | int | None) -> str:
    if value is None or value == "":
        return ""
    try:
        amount = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("OpenSandbox memory limit must be an integer number of MiB") from exc
    if amount <= 0:
        raise ValueError("OpenSandbox memory limit must be positive")
    return f"{amount}Mi"


def _creation_env(egress_mode: str) -> dict[str, str] | None:
    """Configure the egress proxy when its endpoint is supplied by the operator."""
    ports = {"packages": 3128, "allowlist": 3129, "full": 3130}
    if egress_mode == "none":
        return None
    if egress_mode not in ports:
        raise ValueError("OpenSandbox egress_mode must be none, packages, allowlist, or full")
    base_url = (os.getenv("SANDBOX_EGRESS_PROXY_BASE_URL") or "").strip().rstrip("/")
    if not base_url:
        return None
    proxy = f"{base_url}:{ports[egress_mode]}"
    return {
        "HTTP_PROXY": proxy,
        "HTTPS_PROXY": proxy,
        "http_proxy": proxy,
        "https_proxy": proxy,
        "NO_PROXY": "localhost,127.0.0.1",
        "no_proxy": "localhost,127.0.0.1",
    }


class _AsyncLoop:
    """Keep asynchronous SDK clients on one event loop for their full lifetime."""

    def __init__(self) -> None:
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(
            target=self.loop.run_forever, daemon=True, name="opensandbox-loop"
        )
        self.thread.start()

    def run(self, awaitable: Any, *, timeout: float | None = None) -> Any:
        future = asyncio.run_coroutine_threadsafe(awaitable, self.loop)
        return future.result(timeout=timeout)

    def submit(self, awaitable: Any):
        return asyncio.run_coroutine_threadsafe(awaitable, self.loop)

    def close(self) -> None:
        if self.loop.is_running():
            self.loop.call_soon_threadsafe(self.loop.stop)
        self.thread.join(timeout=2)
        if not self.loop.is_running():
            self.loop.close()


class _SandboxProcess:
    """Expose streamed SDK output through BaseEnvironment's ProcessHandle contract."""

    def __init__(self) -> None:
        self._output: queue.Queue[Any] = queue.Queue()
        self._done = threading.Event()
        self._returncode: int | None = None
        self._future = None
        self.pid = None

    @property
    def stdout(self):
        def chunks():
            while True:
                chunk = self._output.get()
                if chunk is _END_OF_OUTPUT:
                    return
                yield chunk

        return chunks()

    @property
    def returncode(self) -> int | None:
        return self._returncode

    def poll(self) -> int | None:
        return self._returncode if self._done.is_set() else None

    def wait(self, timeout: float | None = None) -> int:
        if not self._done.wait(timeout):
            raise TimeoutError("OpenSandbox command is still running")
        return self._returncode if self._returncode is not None else 1

    def feed(self, text: str) -> None:
        if text:
            self._output.put(text)

    def finish(self, returncode: int) -> None:
        self._returncode = returncode
        self._done.set()
        self._output.put(_END_OF_OUTPUT)

    def kill(self) -> None:
        if self._future is not None:
            self._future.cancel()
        self.finish(124)


class OpenSandboxEnvironment(BaseEnvironment):
    """Execute commands in an Alibaba OpenSandbox instance."""

    _stdin_mode = "payload"
    _snapshot_timeout = 60

    def __init__(
        self,
        image: str,
        cwd: str = "/workspace",
        timeout: int = 60,
        task_id: str = "default",
        env: dict | None = None,
        *,
        server_url: str | None = None,
        api_key: str | None = None,
        ttl_minutes: int = 30,
        persistent: bool = False,
        persistent_volume: str | None = None,
        volume_mount_path: str = "/workspace",
        cpu: str | int | float | None = None,
        memory: str | int | None = None,
        disk: int | None = None,
        egress_mode: str = "packages",
    ) -> None:
        ConnectionConfig, Sandbox = _load_sdk()
        server_url = (
            server_url
            or os.getenv("OPEN_SANDBOX_DOMAIN")
            or os.getenv("SANDBOX_SERVER_URL")
            or ""
        ).strip()
        if not server_url:
            raise ValueError(
                "OpenSandbox requires server_url (or OPEN_SANDBOX_DOMAIN) "
                "to point to a running OpenSandbox server."
            )

        super().__init__(cwd=cwd, timeout=timeout, env=env)
        protocol, separator, domain = server_url.partition("://")
        config_args = {
            "domain": domain if separator else server_url,
            "protocol": protocol if separator else "http",
            "api_key": (
                api_key
                or os.getenv("OPEN_SANDBOX_API_KEY")
                or os.getenv("SANDBOX_SERVER_API_KEY")
                or None
            ),
            "request_timeout": timedelta(seconds=180),
        }
        if persistent_volume:
            config_args["use_server_proxy"] = True

        self._loop = _AsyncLoop()
        self._sandbox = None
        self._closed = False
        self._ttl = timedelta(minutes=ttl_minutes)
        self._task_id = task_id
        self._Sandbox = Sandbox
        self._persistent = persistent or bool(persistent_volume)
        if self._persistent and not persistent_volume:
            suffix = hashlib.sha256(task_id.encode("utf-8")).hexdigest()[:24]
            persistent_volume = f"akramcode-{suffix}"
        if disk not in (None, 0, 51200):
            logger.warning("OpenSandbox uses server-managed volume size; disk=%s is ignored", disk)
        try:
            create_args: dict[str, Any] = {
                "connection_config": ConnectionConfig(**config_args),
                "timeout": self._ttl,
                "env": {**(env or {}), **(_creation_env(egress_mode) or {})} or None,
            }
            if cpu is not None or memory is not None:
                create_args["resource"] = {
                    "cpu": str(cpu) if cpu is not None else "",
                    "memory": _memory_limit(memory),
                }
            if persistent_volume:
                from opensandbox.models.sandboxes import PVC, Volume

                create_args["volumes"] = [
                    Volume(
                        name="akramcode-workspace",
                        pvc=PVC(
                            claim_name=persistent_volume,
                            create_if_not_exists=True,
                            delete_on_sandbox_termination=False,
                        ),
                        mount_path=volume_mount_path,
                    )
                ]
            self._sandbox = self._loop.run(
                Sandbox.create(image, **create_args), timeout=240
            )
            self.init_session()
        except Exception:
            self._loop.close()
            raise

    def _before_execute(self) -> None:
        if self._closed or self._sandbox is None:
            raise EnvironmentConnectionError("OpenSandbox environment is closed")
        try:
            self._loop.run(self._sandbox.renew(self._ttl), timeout=30)
        except Exception as exc:
            raise EnvironmentConnectionError(
                f"Could not renew OpenSandbox sandbox: {exc}"
            ) from exc

    def _run_bash(
        self,
        cmd_string: str,
        *,
        login: bool = False,
        timeout: int = 120,
        stdin_data: str | None = None,
    ):
        if self._sandbox is None:
            raise EnvironmentConnectionError("OpenSandbox environment is unavailable")

        if stdin_data is not None:
            from opensandbox.services.filesystem import WriteEntry

            stdin_path = self._staged_stdin_path()
            self._loop.run(
                self._sandbox.files.write_files(
                    [WriteEntry(path=stdin_path, data=stdin_data.encode("utf-8", "surrogateescape"))]
                ),
                timeout=60,
            )
            cmd_string = self._redirect_stdin_from_file(cmd_string, stdin_path)

        flags = "-lc" if login else "-c"
        shell_command = f"bash {flags} {shlex.quote(cmd_string)}"
        process = _SandboxProcess()

        async def execute() -> None:
            from opensandbox.models.execd import ExecutionHandlers, RunCommandOpts

            async def stream(messages: Any) -> None:
                for message in messages if isinstance(messages, list) else [messages]:
                    text = getattr(message, "text", None)
                    if text is None:
                        text = str(message)
                    process.feed(text if text.endswith("\n") else text + "\n")

            handlers = ExecutionHandlers(
                on_stdout=stream, on_stderr=stream, skip_accumulation=True
            )
            try:
                result = await self._sandbox.commands.run(
                    shell_command,
                    opts=RunCommandOpts(timeout=timedelta(seconds=timeout + 15)),
                    handlers=handlers,
                )
                error = getattr(result, "error", None)
                code = getattr(result, "exit_code", None)
                if error and code in (None, 0):
                    process.feed(f"\n[OpenSandbox error] {error}\n")
                    code = 1
                process.finish(code if isinstance(code, int) else 0)
            except asyncio.CancelledError:
                process.finish(124)
                raise
            except Exception as exc:
                logger.exception("OpenSandbox command failed (task=%s)", self._task_id)
                process.feed(f"\n[OpenSandbox transport error] {exc}\n")
                process.finish(1)

        process._future = self._loop.submit(execute())
        return process

    def cleanup(self) -> None:
        if self._closed:
            return
        self._closed = True
        sandbox, self._sandbox = self._sandbox, None
        try:
            if sandbox is not None:
                try:
                    self._loop.run(sandbox.kill(), timeout=30)
                except Exception:
                    if not self._persistent:
                        logger.warning("Could not remove OpenSandbox instance", exc_info=True)
                finally:
                    try:
                        self._loop.run(sandbox.close(), timeout=15)
                    except Exception:
                        logger.debug("Could not close OpenSandbox client", exc_info=True)
        finally:
            self._loop.close()
