#!/usr/bin/env python3
"""Run a release command behind a loopback proxy that only tunnels HTTPS."""

from __future__ import annotations

import json
import os
import re
import shutil
import select
import signal
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit


MAX_PROXY_HEADERS = 16 * 1024
CHILD_TERMINATION_GRACE_SECONDS = 10
TLS_RECORD_PREFIX = b"\x16\x03"


def send_proxy_error(connection: socket.socket, status: int, message: str) -> None:
    body = (message + "\n").encode("utf-8")
    response = (
        f"HTTP/1.1 {status} {message}\r\n"
        "Connection: close\r\n"
        "Content-Type: text/plain; charset=utf-8\r\n"
        f"Content-Length: {len(body)}\r\n\r\n"
    ).encode("ascii") + body
    try:
        connection.sendall(response)
    except OSError:
        pass


class HttpsOnlyProxyHandler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        client: socket.socket = self.request
        client.settimeout(10)
        header = bytearray()
        try:
            while not header.endswith(b"\r\n\r\n"):
                chunk = client.recv(1)
                if not chunk:
                    return
                header.extend(chunk)
                if len(header) > MAX_PROXY_HEADERS:
                    send_proxy_error(client, 431, "Request Header Fields Too Large")
                    return
        except OSError:
            return

        request_line = bytes(header).split(b"\r\n", 1)[0]
        parts = request_line.decode("ascii", errors="replace").split()
        if len(parts) != 3 or parts[0].upper() != "CONNECT":
            print(
                "Release runner blocked a cleartext HTTP package request.",
                file=sys.stderr,
                flush=True,
            )
            send_proxy_error(client, 403, "HTTPS CONNECT Required")
            return

        try:
            authority = urlsplit(f"//{parts[1]}")
            host = authority.hostname
            port = authority.port
            if not host or port is None or authority.username or authority.password:
                raise ValueError("invalid CONNECT authority")
        except ValueError:
            send_proxy_error(client, 400, "Invalid CONNECT Authority")
            return

        try:
            client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            # Do not establish an upstream connection until the client proves
            # the tunnel carries a TLS handshake, not cleartext HTTP.
            prefix = bytearray()
            while len(prefix) < 3:
                chunk = client.recv(3 - len(prefix))
                if not chunk:
                    return
                prefix.extend(chunk)
            if prefix[0:2] != TLS_RECORD_PREFIX:
                print(
                    "Release runner blocked a non-TLS proxy tunnel.",
                    file=sys.stderr,
                    flush=True,
                )
                return

            upstream = socket.create_connection((host, port), timeout=15)
        except OSError:
            send_proxy_error(client, 502, "HTTPS Upstream Unavailable")
            return

        try:
            upstream.settimeout(None)
            client.settimeout(None)
            upstream.sendall(prefix)
            relay_tls_tunnel(client, upstream)
        finally:
            upstream.close()


def relay_tls_tunnel(client: socket.socket, upstream: socket.socket) -> None:
    peers = (client, upstream)
    while True:
        readable, _, _ = select.select(peers, (), ())
        for source in readable:
            destination = upstream if source is client else client
            try:
                payload = source.recv(64 * 1024)
                if not payload:
                    return
                destination.sendall(payload)
            except OSError:
                return


class LoopbackProxyServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    block_on_close = False


def prepare_pnpm_command(
    command: list[str], environment: dict[str, str]
) -> tuple[list[str], dict[str, str], tempfile.TemporaryDirectory[str] | None]:
    if command[0] != "pnpm":
        return command, environment, None

    repo_root = environment.get("RELEASE_REPO_ROOT", os.getcwd())
    package_json_path = os.path.join(repo_root, "package.json")
    try:
        with open(package_json_path, encoding="utf-8") as package_file:
            package = json.load(package_file)
            package_manager = (
                package.get("packageManager") if isinstance(package, dict) else None
            )
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(
            f"Release command could not read the workspace packageManager pin: {error}"
        ) from error

    match = re.fullmatch(
        r"pnpm@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)",
        str(package_manager),
    )
    if match is None:
        raise ValueError(
            "Release command requires package.json packageManager to pin an exact pnpm version."
        )
    pnpm_version = match.group(1)

    registry = environment.get(
        "RELEASE_NODE_NPM_REGISTRY", "https://registry.npmjs.org/"
    )
    try:
        registry_url = urlsplit(registry)
        registry_url.port
    except ValueError as error:
        raise ValueError(
            "Release command requires a valid HTTPS registry for pinned pnpm acquisition."
        ) from error
    if (
        registry_url.scheme.lower() != "https"
        or not registry_url.hostname
        or registry_url.username
        or registry_url.password
        or any(character.isspace() for character in registry)
    ):
        raise ValueError(
            "Release command requires a valid HTTPS registry for pinned pnpm acquisition."
        )

    npm_bin = shutil.which("npm", path=environment.get("PATH"))
    if npm_bin is None:
        raise FileNotFoundError(
            "Release command could not find npm to provision the pinned pnpm version."
        )

    tool_cache = tempfile.TemporaryDirectory(
        prefix="run-release-pnpm-", dir=environment.get("TMPDIR") or None
    )
    os.chmod(tool_cache.name, 0o700)
    npm_cache = os.path.join(tool_cache.name, "npm-cache")
    os.mkdir(npm_cache, 0o700)
    pinned_environment = environment.copy()
    pinned_environment["npm_config_cache"] = npm_cache
    pinned_environment["npm_config_registry"] = registry
    pinned_environment["NPM_CONFIG_REGISTRY"] = registry

    return (
        [
            npm_bin,
            "exec",
            "--yes",
            f"--package=pnpm@{pnpm_version}",
            "--",
            "pnpm",
            *command[1:],
        ],
        pinned_environment,
        tool_cache,
    )


def run(command: list[str]) -> int:
    if not command:
        print("Release command runner requires a command.", file=sys.stderr)
        return 2

    tool_cache: tempfile.TemporaryDirectory[str] | None = None
    try:
        command, prepared_environment, tool_cache = prepare_pnpm_command(
            command, os.environ.copy()
        )
    except FileNotFoundError as error:
        print(str(error), file=sys.stderr)
        return 127
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1

    server = LoopbackProxyServer(("127.0.0.1", 0), HttpsOnlyProxyHandler)
    proxy_url = f"http://127.0.0.1:{server.server_address[1]}"
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    child_environment = prepared_environment
    for name in ("HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy",
                 "ALL_PROXY", "all_proxy"):
        child_environment[name] = proxy_url
    child_environment["NO_PROXY"] = ""
    child_environment["no_proxy"] = ""

    child: subprocess.Popen[bytes] | None = None
    received_signal: int | None = None

    def forward_signal(signum: int, _frame: object) -> None:
        nonlocal received_signal
        received_signal = signum
        if child is not None:
            try:
                os.killpg(child.pid, signum)
            except ProcessLookupError:
                pass

    for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, forward_signal)

    try:
        child = subprocess.Popen(command, env=child_environment, start_new_session=True)
        termination_started: float | None = None
        while child.poll() is None:
            if received_signal is not None:
                if termination_started is None:
                    termination_started = time.monotonic()
                elif time.monotonic() - termination_started >= CHILD_TERMINATION_GRACE_SECONDS:
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            time.sleep(0.05)
        return_code = child.returncode
        if return_code is None:
            return 1
        if return_code < 0:
            return 128 + -return_code
        return return_code
    except OSError as error:
        print(f"Release command could not be started: {error}", file=sys.stderr)
        return 127
    finally:
        if child is not None and child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=2)
        if tool_cache is not None:
            tool_cache.cleanup()


if __name__ == "__main__":
    raise SystemExit(run(sys.argv[1:]))
