import os
import pathlib
import shlex
import socket
import subprocess
import tempfile
import textwrap
import tomllib
import unittest


WORKSPACE_ROOT = pathlib.Path(__file__).resolve().parents[1]
STARTUP_SCRIPT = WORKSPACE_ROOT / "scripts/start_local_model_eval_proxy.sh"

FAKE_OLLAMA = textwrap.dedent(
    """\
    #!/usr/bin/env python3
    import json
    import os
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/api/version":
                body = {"version": "startup-test"}
            elif self.path == "/api/tags":
                body = {
                    "models": [{
                        "name": "qwen3:8b",
                        "digest": os.environ["TEST_MODEL_DIGEST"],
                    }]
                }
            elif self.path == "/v1/models":
                body = {"data": [{"id": "qwen3:8b"}]}
            else:
                self.send_error(404)
                return

            encoded = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, _format, *_args):
            return

    host, port = os.environ["OLLAMA_HOST"].rsplit(":", 1)
    ThreadingHTTPServer((host, int(port)), Handler).serve_forever()
    """
)


class LocalModelEndpointStartupTests(unittest.TestCase):
    def test_workspace_boot_runs_the_detached_endpoint_startup_helper(self):
        config = tomllib.loads((WORKSPACE_ROOT / ".replit").read_text())

        self.assertEqual(
            config.get("onBoot"),
            "bash scripts/start_local_model_eval_proxy.sh start",
        )
        self.assertTrue(STARTUP_SCRIPT.is_file())
        subprocess.run(["bash", "-n", str(STARTUP_SCRIPT)], check=True)

    def test_endpoint_listener_and_model_digest_remain_pinned(self):
        import local_model_eval_proxy as proxy

        self.assertEqual(proxy.PROXY_HOST, "127.0.0.1")
        self.assertEqual(proxy.OLLAMA_HOST, "127.0.0.1:11435")
        self.assertEqual(
            proxy.MODEL_DIGEST,
            "500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41",
        )

    def test_model_endpoint_ports_are_not_exposed_through_replit_port_mappings(self):
        config = tomllib.loads((WORKSPACE_ROOT / ".replit").read_text())
        mapped_ports = {
            value
            for mapping in config.get("ports", [])
            for value in (mapping.get("localPort"), mapping.get("externalPort"))
            if isinstance(value, int)
        }

        self.assertTrue({11434, 11435}.isdisjoint(mapped_ports))


class LocalModelEndpointLifecycleTests(unittest.TestCase):
    def setUp(self):
        for port, _address in self.listener_rows():
            self.skipTest(f"Local model listener on port {port} is already active.")
        for port in (11434, 11435):
            listener = socket.socket()
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                listener.bind(("127.0.0.1", port))
            except OSError:
                listener.close()
                self.skipTest(f"Loopback port {port} is already in use.")
            listener.close()

        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = pathlib.Path(self.temporary_directory.name)
        self.fake_bin = self.root / "bin"
        self.fake_bin.mkdir()
        fake_ollama = self.fake_bin / "ollama"
        fake_ollama.write_text(FAKE_OLLAMA)
        fake_ollama.chmod(0o700)
        self.environment = os.environ.copy()
        self.environment["PATH"] = f"{self.fake_bin}:{self.environment['PATH']}"
        self.environment["LOCAL_MODEL_ENDPOINT_STATE_DIR"] = str(self.root / "state")
        self.environment["LOCAL_MODEL_STARTUP_TIMEOUT_SECONDS"] = "15"
        self.environment["TEST_MODEL_DIGEST"] = (
            "500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41"
        )
        self.addCleanup(self.stop_endpoint)

    def run_helper(self, action, check=True):
        result = subprocess.run(
            ["bash", str(STARTUP_SCRIPT), action],
            cwd=WORKSPACE_ROOT,
            env=self.environment,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if check:
            self.assertEqual(
                result.returncode,
                0,
                msg=f"Startup helper {action!r} failed: {result.stderr}",
            )
        return result

    def stop_endpoint(self):
        self.run_helper("stop", check=False)

    def listener_rows(self):
        rows = []
        for line in pathlib.Path("/proc/net/tcp").read_text().splitlines()[1:]:
            fields = line.split()
            if len(fields) < 4 or fields[3] != "0A":
                continue
            address, port_text = fields[1].split(":")
            port = int(port_text, 16)
            if port in {11434, 11435}:
                rows.append((port, address))
        return sorted(rows)

    def test_start_stop_and_configured_boot_command_are_loopback_only(self):
        config = tomllib.loads((WORKSPACE_ROOT / ".replit").read_text())
        boot_command = config["onBoot"]

        self.run_helper("start")
        self.run_helper("status")
        self.assertEqual(
            self.listener_rows(),
            [(11434, "0100007F"), (11435, "0100007F")],
        )

        self.run_helper("stop")
        self.assertEqual(self.listener_rows(), [])

        boot_result = subprocess.run(
            shlex.split(boot_command),
            cwd=WORKSPACE_ROOT,
            env=self.environment,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(boot_result.returncode, 0, msg=boot_result.stderr)
        self.run_helper("status")
        self.assertEqual(
            self.listener_rows(),
            [(11434, "0100007F"), (11435, "0100007F")],
        )


if __name__ == "__main__":
    unittest.main()
