"""macOS metadata primitives. No decision files or private evidence are read here."""

import ctypes
import fcntl
import json
import os
import re
import stat
import subprocess
import sys


def process_identity(pid):
    # Darwin's public <libproc.h> proc_bsdinfo / PROC_PIDTBSDINFO contract.
    # lstart/ps has only second precision and cannot safely detect PID reuse.
    class ProcBsdInfo(ctypes.Structure):
        _fields_ = [
            (name, ctypes.c_uint32)
            for name in (
                "flags", "status", "xstatus", "pid", "ppid", "uid", "gid",
                "ruid", "rgid", "svuid", "svgid", "rfu_1",
            )
        ] + [
            ("comm", ctypes.c_char * 16),
            ("name", ctypes.c_char * 32),
        ] + [
            (name, ctypes.c_uint32)
            for name in ("nfiles", "pgid", "pjobc", "e_tdev", "e_tpgid")
        ] + [
            ("nice", ctypes.c_int32),
            ("start_tvsec", ctypes.c_uint64),
            ("start_tvusec", ctypes.c_uint64),
        ]

    info = ProcBsdInfo()
    if ctypes.sizeof(info) != 136:
        raise RuntimeError("unsupported Darwin process-info layout")
    libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    libproc.proc_pidinfo.argtypes = [
        ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int,
    ]
    libproc.proc_pidinfo.restype = ctypes.c_int
    size = libproc.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
    if (size != ctypes.sizeof(info) or info.pid != pid
            or info.start_tvsec == 0 or info.start_tvusec >= 1_000_000):
        raise RuntimeError("cannot establish Darwin process-start identity")
    boot_id = subprocess.run(
        ["/usr/sbin/sysctl", "-n", "kern.bootsessionuuid"],
        check=True, capture_output=True, text=True, timeout=5,
    ).stdout.strip().lower()
    if not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", boot_id):
        raise RuntimeError("cannot establish Darwin boot identity")
    return {
        "platform": "darwin",
        "bootId": boot_id,
        "startTimeMicros": str(info.start_tvsec * 1_000_000 + info.start_tvusec),
    }


def exec_with_gate(gate_path, command):
    # Never unlink this file: contenders must always lock the same inode.
    fd = os.open(gate_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        raise RuntimeError("metadata recovery gate is not a regular file")
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError("metadata lock recovery is already in progress") from None
    # exec keeps both the PID and the lock alive in the worker, even if its
    # caller dies. close-on-exec would silently release the recovery gate.
    os.set_inheritable(fd, True)
    os.execv(command[0], command)


def main():
    if sys.platform != "darwin":
        raise RuntimeError("Darwin metadata helper requires a real macOS runtime")
    if len(sys.argv) == 3 and sys.argv[1] == "identity":
        pid = int(sys.argv[2])
        if not 0 < pid <= 2_147_483_647:
            raise RuntimeError("invalid metadata owner PID")
        print(json.dumps(process_identity(pid)))
    elif len(sys.argv) >= 4 and sys.argv[1] == "gate":
        exec_with_gate(sys.argv[2], sys.argv[3:])
    else:
        raise RuntimeError("invalid Darwin metadata helper invocation")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
