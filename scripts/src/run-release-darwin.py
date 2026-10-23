"""Pinned local macOS command runner; kernel locks, no GNU tools required."""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import shutil
import stat
import subprocess
import sys
import tempfile
import time


def main():
    if sys.platform != "darwin":
        raise RuntimeError("macOS runner requires a real macOS host")
    if len(sys.argv) < 2:
        raise RuntimeError("usage: bash scripts/src/run-release-node.sh <command> [args...]")
    root = Path(__file__).resolve().parents[2]
    required_node = (root / ".nvmrc").read_text().strip()
    required_pnpm = json.loads((root / "package.json").read_text())["packageManager"].split("@")[1]
    node_path = shutil.which("node")
    if node_path is None:
        raise RuntimeError("macOS runner could not find Node on PATH")
    for command, version in ((node_path, "v" + required_node), ("pnpm", required_pnpm)):
        actual = subprocess.run(
            [command, "--version"], capture_output=True, text=True, check=True, timeout=30,
        ).stdout.strip()
        if actual != version:
            raise RuntimeError(f"macOS runner requires {command} {version}; found {actual}")

    key = hashlib.sha256(str(root).encode()).hexdigest()
    # A separate name from the Linux runner avoids mixing file formats. Both
    # runners reject the other's host OS; this is a local-filesystem contract.
    lock_dir = Path(tempfile.gettempdir()) / f"metadata-validation-{os.getuid()}"
    try:
        lock_dir.mkdir(mode=0o700)
    except FileExistsError:
        pass
    info = lock_dir.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o700):
        raise RuntimeError("macOS validation lock directory is unsafe")
    fd = os.open(lock_dir / key, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    lock_stat = os.fstat(fd)
    if not stat.S_ISREG(lock_stat.st_mode) or lock_stat.st_uid != os.getuid():
        raise RuntimeError("macOS validation lock is unsafe")
    os.fchmod(fd, 0o600)
    if os.environ.get("RELEASE_RUNNER_LOCK_KEY") != key:
        raw_wait = os.environ.get("RELEASE_RUNNER_LOCK_WAIT_SECONDS", "7200")
        if not raw_wait.isascii() or not raw_wait.isdecimal() or not 0 <= int(raw_wait) <= 7200:
            raise RuntimeError("RELEASE_RUNNER_LOCK_WAIT_SECONDS must be between 0 and 7200")
        deadline = time.monotonic() + int(raw_wait)
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    print("macOS workspace validation lock wait timed out; retry later", file=sys.stderr)
                    return 75
                time.sleep(0.1)

    env = dict(os.environ, PATH=str(Path(node_path).parent) + os.pathsep + os.environ.get("PATH", ""),
               RELEASE_RUNNER_LOCK_KEY=key, RELEASE_NODE_VERSION=required_node,
               RELEASE_REPO_ROOT=str(root))
    subprocess.run(["node", str(root / "scripts/src/check-routine-node-version.mjs")],
                   env=env, check=True)
    # Keep the lock alive in both supervisor and child. On supervisor death
    # the running command still holds it. Do not unlink the lock inode.
    child = subprocess.Popen(sys.argv[1:], env=env, pass_fds=(fd,), start_new_session=True)

    def stop(signum, _frame):
        os.killpg(child.pid, signum)

    for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, stop)
    result = child.wait()
    return result if result >= 0 else 128 - result


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"macOS validation runner: {error}", file=sys.stderr)
        sys.exit(1)
