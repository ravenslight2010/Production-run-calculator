#!/usr/bin/env python3
"""Run only fixture-owned startup children with a PTY and bounded session."""

import errno
import os
import pty
import select
import signal
import subprocess
import sys
import time

MAX_PROCESSES = 16
TIMEOUT_SECONDS = 60


def main() -> int:
    master, slave = pty.openpty()
    child = None
    peak = 0
    try:
        child = subprocess.Popen(
            sys.argv[1:],
            stdin=slave,
            stdout=slave,
            stderr=slave,
            start_new_session=True,
        )
        os.close(slave)
        slave = -1
        deadline = time.monotonic() + TIMEOUT_SECONDS
        stream_open = True
        while child.poll() is None or stream_open:
            sessions = subprocess.run(
                ["ps", "-e", "-o", "sid=", "-o", "stat="],
                capture_output=True,
                text=True,
                check=True,
                timeout=2,
            ).stdout.splitlines()
            count = sum(
                1
                for line in sessions
                if len(parts := line.split()) == 2
                and parts[0] == str(child.pid)
                and not parts[1].startswith("Z")
            )
            peak = max(peak, count)
            if count > MAX_PROCESSES or time.monotonic() >= deadline:
                print("Fixture pnpm startup exceeded its process/time bound.", file=sys.stderr)
                return 124
            if stream_open and select.select([master], [], [], 0.05)[0]:
                try:
                    data = os.read(master, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    data = b""
                if data:
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
                else:
                    stream_open = False
            elif not stream_open:
                time.sleep(0.05)
        print(f"PNPM_FIXTURE_MAX_PROCESSES={peak}")
        return child.wait()
    finally:
        if child is not None:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
        os.close(master)
        if slave >= 0:
            os.close(slave)


if __name__ == "__main__":
    raise SystemExit(main())
