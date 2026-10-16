#!/usr/bin/env python3
"""Install and manage the pinned, private local-model evaluation endpoint."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import subprocess
import sys
import urllib.error
import urllib.request

import local_model_eval_proxy as proxy

WORKSPACE_ROOT = Path(__file__).resolve().parents[1]
EVAL_HOME = proxy.EVAL_HOME
RUNTIME_DIR = proxy.RUNTIME_ROOT
MODEL_DIR = proxy.MODEL_ROOT
MARKER = EVAL_HOME / "OWNED_BY_LOCAL_AI_EVAL"
STATE_MARKER = "local-ai-eval-owned-paths-v2"
OWNED_RELATIVE_PATHS = (
    "models/qwen3.5-9b-q3_k_m",
    "runtime/ollama-0.40.5",
)

OLLAMA_VERSION = "0.40.5"
OLLAMA_ARCHIVE_URL = (
    "https://github.com/ollama/ollama/releases/download/"
    "v0.40.5/ollama-linux-amd64.tar.zst"
)
OLLAMA_ARCHIVE_SHA256 = (
    "dc5eabc292f9949546c90a97c820f924b035e05243b0de13c7f366182562169c"
)
MODEL_REVISION = "9345434ae3c14ecb7b5021df007518f70b2a5231"
MODEL_BASE_URL = (
    "https://huggingface.co/mradermacher/Qwen3.5-9B-GGUF/resolve/"
    f"{MODEL_REVISION}"
)
MODEL_FILES = (
    (
        "Qwen3.5-9B.Q3_K_M.gguf",
        proxy.MODEL_FILE_SHA256,
        4_616_185_088,
    ),
    (
        "Qwen3.5-9B.mmproj-f16.gguf",
        proxy.MMPROJ_FILE_SHA256,
        918_165_952,
    ),
)
MIN_DISK_FREE_BYTES = 8 * 1024**3
MIN_MEMORY_LIMIT_BYTES = 12 * 1024**3
MIN_MEMORY_AVAILABLE_BYTES = 8 * 1024**3


class SetupError(RuntimeError):
    """A safe, user-actionable setup or lifecycle failure."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def inspect_resources(
    *,
    system: str | None = None,
    machine: str | None = None,
    cpu_quota_text: str | None = None,
    memory_limit_text: str | None = None,
    memory_current_text: str | None = None,
    disk_free_bytes: int | None = None,
) -> dict[str, int | str]:
    system = system or platform.system()
    machine = machine or platform.machine()
    if cpu_quota_text is None:
        try:
            cpu_quota_text = Path("/sys/fs/cgroup/cpu.max").read_text().strip()
        except OSError:
            cpu_quota_text = "max 100000"
    if memory_limit_text is None:
        try:
            memory_limit_text = Path("/sys/fs/cgroup/memory.max").read_text().strip()
        except OSError:
            memory_limit_text = "max"
    if memory_current_text is None:
        try:
            memory_current_text = Path("/sys/fs/cgroup/memory.current").read_text().strip()
        except OSError:
            memory_current_text = "0"
    if disk_free_bytes is None:
        disk_free_bytes = shutil.disk_usage(WORKSPACE_ROOT).free

    quota, period = cpu_quota_text.split()
    cpu_threads = (
        max(1, int(quota) // int(period))
        if quota != "max"
        else max(1, os.cpu_count() or 1)
    )
    if memory_limit_text == "max":
        try:
            memory_limit = next(
                int(line.split()[1]) * 1024
                for line in Path("/proc/meminfo").read_text().splitlines()
                if line.startswith("MemTotal:")
            )
        except (OSError, StopIteration, ValueError):
            memory_limit = 0
    else:
        memory_limit = int(memory_limit_text)
    memory_current = int(memory_current_text)
    return {
        "system": system,
        "machine": machine,
        "cpu_threads": cpu_threads,
        "memory_limit_bytes": memory_limit,
        "memory_available_bytes": max(0, memory_limit - memory_current),
        "disk_free_bytes": disk_free_bytes,
    }


def check_resources(resources: dict[str, int | str]) -> None:
    if resources["system"] != "Linux" or resources["machine"] not in {"x86_64", "amd64"}:
        raise SetupError("This pinned evaluator supports Linux x86_64 only.")
    if int(resources["cpu_threads"]) < 4:
        raise SetupError("At least 4 available CPU threads are required.")
    if int(resources["memory_limit_bytes"]) < MIN_MEMORY_LIMIT_BYTES:
        raise SetupError("The evaluator requires at least 12 GiB of available cgroup/system memory.")
    if int(resources["memory_available_bytes"]) < MIN_MEMORY_AVAILABLE_BYTES:
        raise SetupError("At least 8 GiB of memory headroom is required while application services run.")
    if int(resources["disk_free_bytes"]) < MIN_DISK_FREE_BYTES:
        raise SetupError("At least 8 GiB of free workspace storage is required for pinned artifacts.")


def _download_verified(
    url: str,
    destination: Path,
    digest: str,
    size: int | None,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = destination.with_name(destination.name + ".part")
    temporary.unlink(missing_ok=True)
    command = [
        "curl",
        "--fail",
        "--location",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--retry",
        "2",
        "--connect-timeout",
        "15",
        "--max-time",
        "900",
        "--output",
        str(temporary),
        url,
    ]
    try:
        subprocess.run(
            command,
            check=True,
            capture_output=True,
            timeout=905,
        )
        if (
            (size is not None and temporary.stat().st_size != size)
            or sha256_file(temporary) != digest
        ):
            raise SetupError("A downloaded model artifact failed its pinned size or SHA-256 check.")
        os.replace(temporary, destination)
        destination.chmod(0o600)
    except subprocess.TimeoutExpired:
        raise SetupError("A pinned artifact download timed out; the partial file was removed.") from None
    except (OSError, subprocess.CalledProcessError):
        raise SetupError("A pinned artifact download failed; the partial file was removed.") from None
    finally:
        temporary.unlink(missing_ok=True)


def _runtime_version() -> str:
    command = RUNTIME_DIR / "bin" / "ollama"
    try:
        result = subprocess.run(
            [str(command), "--version"],
            check=False,
            capture_output=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return (result.stdout + result.stderr).decode("utf-8", "replace")


def _valid_runtime() -> bool:
    if RUNTIME_DIR.is_symlink() or not RUNTIME_DIR.is_dir():
        return False
    version = _runtime_version()
    if OLLAMA_VERSION not in version:
        return False
    try:
        proxy.verify_runtime_identity()
    except RuntimeError:
        return False
    return True


def _expected_ownership_marker() -> dict[str, object]:
    return {
        "format": STATE_MARKER,
        "ownedPaths": sorted(OWNED_RELATIVE_PATHS),
    }


def _validate_owned_tree(path: Path, allow_internal_symlinks: bool) -> None:
    root = path.resolve()
    for current, directories, files in os.walk(path, followlinks=False):
        current_path = Path(current)
        for name in directories + files:
            candidate = current_path / name
            if not candidate.is_symlink():
                continue
            if not allow_internal_symlinks:
                raise SetupError("A local evaluator artifact contains a symlink; refusing to use it.")
            try:
                resolved = candidate.resolve(strict=True)
            except OSError:
                raise SetupError("The pinned runtime contains a broken symlink.") from None
            if not resolved.is_relative_to(root):
                raise SetupError("The pinned runtime contains a symlink outside its owned directory.")


def _ownership_marker_is_valid() -> bool:
    if MARKER.is_symlink():
        raise SetupError("The local evaluator ownership marker cannot be a symlink.")
    if not MARKER.exists():
        return False
    try:
        current = json.loads(MARKER.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise SetupError("The local evaluator ownership marker is invalid.") from None
    if current != _expected_ownership_marker():
        raise SetupError("The local evaluator ownership marker does not match this setup.")
    return True


def _ensure_runtime() -> None:
    if _valid_runtime():
        return
    if RUNTIME_DIR.is_symlink():
        raise SetupError("Refusing to replace a symlinked runtime cache path.")
    if RUNTIME_DIR.exists() and not _ownership_marker_is_valid():
        raise SetupError("An unmarked runtime cache is not the pinned evaluator; refusing to replace it.")
    runtime_parent = RUNTIME_DIR.parent
    if runtime_parent.is_symlink() or not runtime_parent.resolve().is_relative_to(EVAL_HOME):
        raise SetupError("Refusing to install the runtime outside the owned evaluation cache.")
    runtime_parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    runtime_parent.chmod(0o700)
    archive = EVAL_HOME / "downloads" / "ollama-linux-amd64.tar.zst"
    _download_verified(OLLAMA_ARCHIVE_URL, archive, OLLAMA_ARCHIVE_SHA256, None)
    extracted = runtime_parent / "ollama-0.40.5.extracting"
    if extracted.exists():
        if extracted.is_symlink():
            raise SetupError("Refusing to replace a symlinked temporary runtime path.")
        shutil.rmtree(extracted)
    extracted.mkdir(mode=0o700)
    try:
        subprocess.run(
            ["tar", "--zstd", "-xf", str(archive), "-C", str(extracted)],
            check=True,
            capture_output=True,
            timeout=300,
        )
        candidate = extracted / "ollama"
        if not candidate.is_dir():
            raise SetupError("The pinned runtime archive has an unexpected layout.")
        old = runtime_parent / "ollama-0.40.5.previous"
        if RUNTIME_DIR.exists():
            if RUNTIME_DIR.is_symlink():
                raise SetupError("Refusing to replace a symlinked runtime cache path.")
            if old.exists():
                shutil.rmtree(old)
            os.replace(RUNTIME_DIR, old)
        os.replace(candidate, RUNTIME_DIR)
        if not _valid_runtime():
            if RUNTIME_DIR.exists():
                shutil.rmtree(RUNTIME_DIR)
            if old.exists():
                os.replace(old, RUNTIME_DIR)
            raise SetupError("The extracted runtime failed its pinned version/build check.")
        if old.exists():
            shutil.rmtree(old)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        raise SetupError("The pinned runtime archive could not be safely extracted.") from None
    finally:
        if extracted.exists():
            shutil.rmtree(extracted)
        archive.unlink(missing_ok=True)


def _valid_model_files() -> bool:
    try:
        proxy.verify_model_files()
    except (OSError, RuntimeError):
        return False
    return True


def _ensure_model_files(*, verify_existing_digest: bool = True) -> None:
    model_parent = MODEL_DIR.parent
    if (
        model_parent.is_symlink()
        or MODEL_DIR.is_symlink()
        or not MODEL_DIR.resolve().is_relative_to(EVAL_HOME)
    ):
        raise SetupError("Refusing to use a symlinked model cache path.")
    MODEL_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    model_parent.chmod(0o700)
    MODEL_DIR.chmod(0o700)
    for name, digest, size in MODEL_FILES:
        destination = MODEL_DIR / name
        if destination.is_file() and not destination.is_symlink():
            if destination.stat().st_size == size and (
                not verify_existing_digest or sha256_file(destination) == digest
            ):
                continue
            if not _ownership_marker_is_valid():
                raise SetupError("An unmarked model file failed identity checks; refusing to replace it.")
            destination.unlink()
        _download_verified(
            f"{MODEL_BASE_URL}/{name}?download=true",
            destination,
            digest,
            size,
        )


def _write_ownership_marker() -> None:
    owned_path = WORKSPACE_ROOT / ".local" / "share" / "local-ai-eval"
    if any(
        path.is_symlink()
        for path in (
            WORKSPACE_ROOT / ".local",
            WORKSPACE_ROOT / ".local" / "share",
            owned_path,
            MARKER,
        )
    ):
        raise SetupError("Refusing to use a cache path outside this workspace.")
    EVAL_HOME.mkdir(parents=True, exist_ok=True, mode=0o700)
    EVAL_HOME.chmod(0o700)
    if not EVAL_HOME.resolve().is_relative_to(WORKSPACE_ROOT):
        raise SetupError("Refusing to use a cache path outside this workspace.")
    if _ownership_marker_is_valid():
        return
    for relative_path in OWNED_RELATIVE_PATHS:
        target = EVAL_HOME / relative_path
        if target.is_symlink() or not target.is_dir():
            raise SetupError("Pinned evaluator artifacts are incomplete; refusing to mark the cache as owned.")
        _validate_owned_tree(
            target,
            allow_internal_symlinks=relative_path == "runtime/ollama-0.40.5",
        )
    model_names = {name for name, _digest, _size in MODEL_FILES}
    if {entry.name for entry in (EVAL_HOME / OWNED_RELATIVE_PATHS[0]).iterdir()} != model_names:
        raise SetupError("The model cache contains unexpected files; refusing to mark them as owned.")
    temporary = MARKER.with_name(MARKER.name + ".tmp")
    temporary.write_text(
        json.dumps(_expected_ownership_marker(), sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.chmod(0o600)
    os.replace(temporary, MARKER)


def _run_helper(action: str) -> None:
    helper = WORKSPACE_ROOT / "scripts" / "start_local_model_eval_proxy.sh"
    try:
        result = subprocess.run(
            ["bash", str(helper), action],
            cwd=WORKSPACE_ROOT,
            check=False,
            timeout=660,
        )
    except subprocess.TimeoutExpired:
        raise SetupError("The private evaluator helper exceeded its bounded startup deadline.") from None
    if result.returncode != 0:
        raise SetupError(f"The private evaluator {action} command failed.")


def _health() -> dict[str, object]:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open("http://127.0.0.1:11434/healthz", timeout=5) as response:
            health = json.load(response)
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        raise SetupError("The local endpoint is unavailable or returned invalid health data.") from None
    if (
        not isinstance(health, dict)
        or health.get("status") != "healthy"
        or health.get("model") != proxy.MODEL
        or health.get("contextLimit") != proxy.CONTEXT_LIMIT
    ):
        raise SetupError("The local endpoint does not match the pinned evaluator identity.")
    return health


def _remove_owned_cache() -> None:
    _run_helper("stop")
    for port in (8008, 11434, 11435):
        with socket.socket() as endpoint:
            endpoint.settimeout(0.5)
            if endpoint.connect_ex(("127.0.0.1", port)) == 0:
                raise SetupError("A local model service is still active; refusing to remove its files.")
    if EVAL_HOME.is_symlink() or not EVAL_HOME.resolve().is_relative_to(WORKSPACE_ROOT):
        raise SetupError("Refusing to remove a cache path outside this workspace.")
    if MARKER.is_symlink() or not MARKER.is_file():
        raise SetupError("The cache ownership marker is missing; refusing to remove unowned files.")
    if not _ownership_marker_is_valid():
        raise SetupError("The cache ownership marker is invalid; refusing to remove files.")
    for relative_path in OWNED_RELATIVE_PATHS:
        target = EVAL_HOME / relative_path
        if target.is_symlink() or not target.resolve().is_relative_to(EVAL_HOME.resolve()):
            raise SetupError("Refusing to remove an evaluator path outside the owned cache.")
        if target.exists():
            _validate_owned_tree(
                target,
                allow_internal_symlinks=relative_path == "runtime/ollama-0.40.5",
            )
            shutil.rmtree(target)
    MARKER.unlink()
    for parent in (
        EVAL_HOME / "models",
        EVAL_HOME / "runtime",
        EVAL_HOME,
    ):
        try:
            parent.rmdir()
        except OSError:
            continue


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=("setup", "serve", "start", "health", "smoke", "stop", "remove"),
    )
    args = parser.parse_args(argv)
    try:
        if args.action == "setup":
            resources = inspect_resources()
            check_resources(resources)
            _ensure_runtime()
            _ensure_model_files()
            _write_ownership_marker()
            _run_helper("start")
            print(json.dumps({"status": "ready", "model": proxy.MODEL, "resources": resources}))
        elif args.action == "serve":
            resources = inspect_resources()
            check_resources(resources)
            _ensure_runtime()
            # The proxy performs the authoritative SHA checks before launching.
            # Avoid reading several GiB twice on every managed restart.
            _ensure_model_files(verify_existing_digest=False)
            _write_ownership_marker()
            return proxy.main()
        elif args.action == "start":
            _run_helper("start")
        elif args.action == "health":
            print(json.dumps(_health(), sort_keys=True))
        elif args.action == "smoke":
            _health()
            result = subprocess.run(
                [sys.executable, str(WORKSPACE_ROOT / "scripts" / "local_model_eval_smoke.py")],
                cwd=WORKSPACE_ROOT,
                check=False,
                timeout=420,
            )
            if result.returncode != 0:
                raise SetupError("The bounded synthetic model smoke test failed.")
        elif args.action == "stop":
            _run_helper("stop")
        elif args.action == "remove":
            _remove_owned_cache()
            print("Removed only the marked local evaluation cache.")
        return 0
    except SetupError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
