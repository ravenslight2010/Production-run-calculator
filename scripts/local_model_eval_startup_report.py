"""Measure repeated private evaluator starts without retaining request data."""

from __future__ import annotations

from datetime import datetime, timezone
import ipaddress
import json
import os
from pathlib import Path
import platform
import subprocess
import time
from typing import Any, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

import local_model_eval_proxy as proxy

APP_HEALTH_URL = "http://127.0.0.1:8080/api/healthz"
MODEL_HEALTH_URL = f"{proxy.MODEL_SERVER_BASE_URL}/health"
MODEL_LIST_URL = f"{proxy.MODEL_SERVER_BASE_URL}/v1/models"
PRIVATE_HEALTH_URL = f"http://{proxy.PROXY_HOST}:{proxy.PROXY_PORT}/healthz"
EVALUATOR_PORTS = {
    "workflowReadiness": proxy.WORKFLOW_READY_PORT,
    "privateApi": proxy.PROXY_PORT,
    "modelServer": proxy.MODEL_SERVER_PORT,
}
OBSERVED_PORTS = {**EVALUATOR_PORTS, "applicationApi": 8080}
CGROUP_ROOT = Path("/sys/fs/cgroup")
PROC_NET_FILES = (Path("/proc/net/tcp"), Path("/proc/net/tcp6"))
DEFAULT_RUNS = 3
MIN_RUNS = 2
MAX_RUNS = 5
PROBE_INTERVAL_SECONDS = 0.5
STARTUP_TIMEOUT_SECONDS = proxy.MODEL_STARTUP_DEADLINE_SECONDS + 120
REPORT_MAX_BYTES = 64 * 1024


class StartupReportError(RuntimeError):
    """A safe, bounded startup-report failure."""


def _read_int(path: Path) -> int | None:
    try:
        raw = path.read_text(encoding="ascii").strip()
        return int(raw) if raw.isdigit() else None
    except (OSError, UnicodeError, ValueError):
        return None


def _read_memory_events(root: Path = CGROUP_ROOT) -> dict[str, int | None]:
    values: dict[str, int | None] = {"oom": None, "oom_kill": None}
    try:
        lines = (root / "memory.events").read_text(encoding="ascii").splitlines()
    except (OSError, UnicodeError):
        return values
    for line in lines[:32]:
        parts = line.split()
        if len(parts) != 2 or parts[0] not in values or not parts[1].isdigit():
            continue
        values[parts[0]] = int(parts[1])
    return values


def cgroup_snapshot(root: Path = CGROUP_ROOT) -> dict[str, Any]:
    limit_text: str | None
    try:
        limit_text = (root / "memory.max").read_text(encoding="ascii").strip()
    except (OSError, UnicodeError):
        limit_text = None
    return {
        "limitBytes": int(limit_text) if limit_text and limit_text.isdigit() else None,
        "currentBytes": _read_int(root / "memory.current"),
        "peakBytes": _read_int(root / "memory.peak"),
        "oomCounters": _read_memory_events(root),
    }


def _decode_proc_address(raw: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    packed = bytes.fromhex(raw)
    if len(packed) == 4:
        return ipaddress.ip_address(packed[::-1])
    if len(packed) == 16:
        # Linux renders each 32-bit word in host byte order in /proc/net/tcp6.
        normalized = b"".join(packed[index:index + 4][::-1] for index in range(0, 16, 4))
        return ipaddress.ip_address(normalized)
    raise ValueError("unexpected proc address width")


def listener_summary(
    proc_net_files: Sequence[Path] = PROC_NET_FILES,
) -> dict[str, dict[str, bool | int]]:
    sockets: dict[int, list[bool]] = {port: [] for port in OBSERVED_PORTS.values()}
    try:
        for proc_file in proc_net_files:
            for line in proc_file.read_text(encoding="ascii").splitlines()[1:]:
                fields = line.split()
                if len(fields) < 4 or fields[3] != "0A":
                    continue
                local = fields[1].split(":")
                if len(local) != 2:
                    continue
                try:
                    port = int(local[1], 16)
                except ValueError:
                    continue
                if port not in sockets:
                    continue
                try:
                    address = _decode_proc_address(local[0])
                    sockets[port].append(address.is_loopback)
                except (ValueError, OSError):
                    sockets[port].append(False)
    except (OSError, UnicodeError):
        raise StartupReportError("Could not inspect local service bindings.") from None

    return {
        name: {
            "listening": bool(sockets[port]),
            "loopbackOnly": bool(sockets[port]) and all(sockets[port]),
            "boundSocketCount": len(sockets[port]),
        }
        for name, port in OBSERVED_PORTS.items()
    }


def _health_summary(
    status_code: int | None,
    payload: object,
) -> dict[str, Any]:
    body = payload if isinstance(payload, dict) else {}
    checks = body.get("checks")
    return {
        "httpStatus": status_code,
        "healthy": status_code == 200 and body.get("status") == "ok",
        "readinessCheckCount": min(len(checks), 128) if isinstance(checks, dict) else None,
    }


def _http_json(
    opener: Any,
    url: str,
    *,
    timeout: float = 2,
) -> tuple[int | None, object]:
    request = Request(url, headers={"Accept": "application/json"})
    try:
        with opener.open(request, timeout=timeout) as response:
            if response.status < 200 or response.status >= 300:
                return response.status, None
            raw = response.read(64 * 1024 + 1)
            if len(raw) > 64 * 1024:
                return response.status, None
            return response.status, json.loads(raw)
    except HTTPError as error:
        return error.code, None
    except (OSError, URLError, TimeoutError, ValueError):
        return None, None


def application_api_health(opener: Any) -> dict[str, Any]:
    status, payload = _http_json(opener, APP_HEALTH_URL, timeout=3)
    return _health_summary(status, payload)


def _model_server_ready(opener: Any) -> tuple[bool, int | None]:
    status, _health = _http_json(opener, MODEL_HEALTH_URL, timeout=1)
    if status != 200:
        return False, status
    status, payload = _http_json(opener, MODEL_LIST_URL, timeout=2)
    data = payload.get("data") if isinstance(payload, dict) else None
    model_ready = isinstance(data, list) and any(
        isinstance(model, dict) and model.get("id") == proxy.MODEL
        for model in data
    )
    return model_ready, status


def _private_api_ready(opener: Any) -> tuple[bool, int | None]:
    status, payload = _http_json(opener, PRIVATE_HEALTH_URL, timeout=2)
    ready = (
        isinstance(payload, dict)
        and payload.get("status") == "healthy"
        and payload.get("model") == proxy.MODEL
        and payload.get("contextLimit") == proxy.CONTEXT_LIMIT
    )
    return bool(ready and status == 200), status


def _memory_current(snapshot: dict[str, Any]) -> int | None:
    value = snapshot.get("currentBytes")
    return value if isinstance(value, int) else None


def _counter_delta(
    before: dict[str, int | None],
    after: dict[str, int | None],
) -> dict[str, int | None]:
    return {
        key: (
            after[key] - before[key]
            if (
                before.get(key) is not None
                and after.get(key) is not None
                and after[key] >= before[key]
            )
            else None
        )
        for key in ("oom", "oom_kill")
    }


def _ensure_report_directory(workspace_root: Path) -> Path:
    evaluator_home = proxy.EVAL_HOME
    try:
        if evaluator_home.is_symlink() or not evaluator_home.resolve().is_relative_to(workspace_root):
            raise StartupReportError("Refusing to write outside the private evaluator directory.")
        report_dir = evaluator_home / "startup-reports"
        if report_dir.is_symlink():
            raise StartupReportError("Refusing to use a symlinked private report directory.")
        report_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        report_dir.chmod(0o700)
        if not report_dir.resolve().is_relative_to(evaluator_home.resolve()):
            raise StartupReportError("Refusing to write outside the private evaluator directory.")
        return report_dir
    except OSError:
        raise StartupReportError("Could not prepare the private startup report directory.") from None


def write_private_report(
    report: dict[str, Any],
    *,
    workspace_root: Path,
) -> Path:
    report_dir = _ensure_report_directory(workspace_root)
    encoded = (json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    if len(encoded) > REPORT_MAX_BYTES:
        raise StartupReportError("The startup report exceeded its size limit.")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = report_dir / f"startup-{stamp}-{time.time_ns()}.json"
    temporary = destination.with_suffix(".json.tmp")
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, destination)
    except OSError:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise StartupReportError("Could not save the private startup report.") from None
    return destination


def _stop_process(process: subprocess.Popen[bytes]) -> bool:
    if process.poll() is None:
        try:
            process.terminate()
        except OSError:
            return process.poll() is not None
        try:
            process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            try:
                process.kill()
            except OSError:
                return process.poll() is not None
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                return False
    return process.poll() is not None


def _measure_one_start(
    sequence: int,
    command: Sequence[str],
    opener: Any,
) -> dict[str, Any]:
    bindings_before = listener_summary()
    if any(bindings_before[name]["listening"] for name in EVALUATOR_PORTS):
        raise StartupReportError(
            "Stop the existing private evaluator before collecting a startup report."
        )

    cgroup_before = cgroup_snapshot()
    api_before = application_api_health(opener)
    started_ns = time.monotonic_ns()
    try:
        process = subprocess.Popen(
            list(command),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError:
        raise StartupReportError("Could not start the private evaluator process.") from None

    model_ready_ns: int | None = None
    private_ready_ns: int | None = None
    model_status: int | None = None
    private_status: int | None = None
    current_peak_sampled: int | None = _memory_current(cgroup_before)
    deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS

    interrupted = False
    try:
        try:
            while time.monotonic() < deadline:
                sample = cgroup_snapshot()
                current = _memory_current(sample)
                if current is not None:
                    current_peak_sampled = max(current_peak_sampled or current, current)

                if model_ready_ns is None:
                    model_ready, model_status = _model_server_ready(opener)
                    if model_ready:
                        model_ready_ns = time.monotonic_ns()
                if model_ready_ns is not None and private_ready_ns is None:
                    private_ready, private_status = _private_api_ready(opener)
                    if private_ready:
                        private_ready_ns = time.monotonic_ns()
                        break
                if process.poll() is not None:
                    break
                time.sleep(PROBE_INTERVAL_SECONDS)
        except KeyboardInterrupt:
            interrupted = True

        cgroup_after_start = cgroup_snapshot()
        api_after = application_api_health(opener)
        bindings_at_ready = listener_summary()
        timed_out = (
            private_ready_ns is None
            and not interrupted
            and process.poll() is None
            and time.monotonic() >= deadline
        )
        status = (
            "ready" if private_ready_ns is not None
            else "interrupted" if interrupted
            else "startup_timeout" if timed_out
            else "process_exited"
        )
    finally:
        process_stopped = _stop_process(process)

    stop_deadline = time.monotonic() + 5
    bindings_after_stop = listener_summary()
    while (
        any(bindings_after_stop[name]["listening"] for name in EVALUATOR_PORTS)
        and time.monotonic() < stop_deadline
    ):
        time.sleep(0.1)
        bindings_after_stop = listener_summary()

    cgroup_after_stop = cgroup_snapshot()
    return {
        "sequence": sequence,
        "startClass": "firstInSeries" if sequence == 1 else "repeatedRestart",
        "status": status,
        "processToModelServerReadyMs": (
            round((model_ready_ns - started_ns) / 1_000_000, 3)
            if model_ready_ns is not None else None
        ),
        "privateApiReadyFromProcessStartMs": (
            round((private_ready_ns - started_ns) / 1_000_000, 3)
            if private_ready_ns is not None else None
        ),
        "modelServerHealthHttpStatus": model_status,
        "privateApiHealthHttpStatus": private_status,
        "applicationApi": {"before": api_before, "after": api_after},
        "cgroup": {
            "before": cgroup_before,
            "maximumSampledCurrentBytes": current_peak_sampled,
            "afterStartup": cgroup_after_start,
            "afterStop": cgroup_after_stop,
            "oomCounterDelta": _counter_delta(
                cgroup_before["oomCounters"],
                cgroup_after_stop["oomCounters"],
            ),
        },
        "bindingsAtReadiness": bindings_at_ready,
        "shutdown": {
            "processExited": process_stopped,
            "evaluatorListenersClosed": not any(
                bindings_after_stop[name]["listening"] for name in EVALUATOR_PORTS
            ),
        },
    }


def run_startup_measurements(
    *,
    run_count: int = DEFAULT_RUNS,
    command: Sequence[str],
    workspace_root: Path,
) -> tuple[Path, bool]:
    validate_run_count(run_count)
    if not command:
        raise StartupReportError("The private evaluator start command is unavailable.")

    opener = build_opener(ProxyHandler({}))
    started_at = datetime.now(timezone.utc).isoformat()
    runs: list[dict[str, Any]] = []
    for sequence in range(1, run_count + 1):
        run = _measure_one_start(sequence, command, opener)
        runs.append(run)
        if (
            run["status"] == "interrupted"
            or not run["shutdown"]["processExited"]
            or not run["shutdown"]["evaluatorListenersClosed"]
        ):
            break

    successful = len(runs) == run_count and all(
        run["status"] == "ready"
        and run["shutdown"]["processExited"]
        and run["shutdown"]["evaluatorListenersClosed"]
        for run in runs
    )
    report = {
        "schemaVersion": 1,
        "createdAt": started_at,
        "model": proxy.MODEL,
        "runtimeVersion": proxy.RUNTIME_VERSION,
        "cacheHandling": "preserved; no caches cleared and no model artifacts removed",
        "host": {
            "operatingSystem": platform.system(),
            "architecture": platform.machine(),
            "cpuThreads": proxy.available_cpu_threads(),
        },
        "cgroupAtReportEnd": cgroup_snapshot(),
        "collectionStatus": "complete" if successful else "incomplete",
        "runs": runs,
    }
    path = write_private_report(report, workspace_root=workspace_root)
    return path, successful


def validate_run_count(run_count: int) -> None:
    if isinstance(run_count, bool) or not isinstance(run_count, int) or not MIN_RUNS <= run_count <= MAX_RUNS:
        raise StartupReportError(f"Choose between {MIN_RUNS} and {MAX_RUNS} repeated starts.")
