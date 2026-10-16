import json
import os
import pathlib
import shlex
import socket
import subprocess
import sys
import threading
import time
import tomllib
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
import urllib.error
import urllib.request
from unittest.mock import patch

import local_model_eval_proxy as proxy

WORKSPACE_ROOT = pathlib.Path(__file__).resolve().parents[1]
ENDPOINT_URL = "http://127.0.0.1:11434/healthz"
WORKFLOW_PROBE_URL = "http://127.0.0.1:8008/healthz"
APP_HEALTH_URL = "http://127.0.0.1:8080/api/healthz"
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def configured_evaluator_workflow():
    config = tomllib.loads((WORKSPACE_ROOT / ".replit").read_text())
    matches = [
        workflow
        for workflow in config["workflows"]["workflow"]
        if workflow.get("name") == "Local AI evaluator (private)"
    ]
    if len(matches) != 1:
        raise AssertionError("Exactly one private evaluator workflow must be configured.")
    return config, matches[0]


class LocalModelEndpointContractTests(unittest.TestCase):
    def test_private_workflow_is_console_only_without_port_wait_and_not_auto_started(self):
        config, workflow = configured_evaluator_workflow()
        self.assertNotIn("onBoot", config)
        self.assertEqual(workflow["metadata"]["outputType"], "console")
        self.assertIsNone(workflow["metadata"].get("waitForPort"))
        self.assertEqual(
            workflow["tasks"][0]["args"],
            "python3 scripts/local_model_eval_setup.py serve",
        )
        self.assertIsNone(workflow["tasks"][0].get("waitForPort"))

    def test_runtime_and_model_identity_are_pinned_not_the_historical_qwen3_profile(self):
        self.assertEqual(proxy.MODEL, "qwen3.5-9b-q3_k_m")
        self.assertEqual(
            proxy.MODEL_FILE_SHA256,
            "36c110646c21b365714c0a7f0d512228276ba0e20b7a9187e7817b8f70fde58e",
        )
        self.assertEqual(
            proxy.MMPROJ_FILE_SHA256,
            "97f420245a85ce129bb764e86a5e21e27d782fe6d6056c6839b9c5fdb8f38289",
        )
        command = proxy.server_command()
        self.assertEqual(command[command.index("--alias") + 1], proxy.MODEL)
        self.assertEqual(proxy.LLAMA_SERVER_COMMIT, "620d2225c")
        self.assertEqual(proxy.MODEL_SERVER_HOST, "127.0.0.1")
        self.assertEqual(proxy.PROXY_HOST, "127.0.0.1")
        self.assertEqual(proxy.PROXY_PORT, 11434)
        self.assertEqual(proxy.WORKFLOW_READY_HOST, "127.0.0.1")
        self.assertEqual(proxy.WORKFLOW_READY_PORT, 8008)
        self.assertEqual(proxy.CONTEXT_LIMIT, 4096)
        self.assertEqual(proxy.MAX_OUTPUT_TOKENS, 256)

    def test_model_endpoint_ports_are_not_exposed_through_replit_mappings(self):
        config, _workflow = configured_evaluator_workflow()
        ports = config.get("ports", [])
        local_ports = {
            value
            for mapping in ports
            for value in (mapping.get("localPort"),)
            if isinstance(value, int)
        }
        external_ports = {
            value
            for mapping in ports
            for value in (mapping.get("externalPort"),)
            if isinstance(value, int)
        }
        readiness_mappings = [mapping for mapping in ports if mapping.get("localPort") == 8008]
        self.assertLessEqual(len(readiness_mappings), 1)
        for mapping in readiness_mappings:
            self.assertNotIn("externalPort", mapping)
        self.assertTrue({11434, 11435}.isdisjoint(local_ports))
        self.assertTrue({8008, 11434, 11435}.isdisjoint(external_ports))

    def test_runtime_identity_rejects_an_unapproved_build(self):
        completed = subprocess.CompletedProcess(
            args=["llama-server", "--version"],
            returncode=0,
            stdout="version: 0.0.0 (other-build)",
            stderr="",
        )
        from unittest.mock import patch

        with (
            patch.object(proxy, "LLAMA_SERVER", pathlib.Path("/pinned/llama-server")),
            patch.object(pathlib.Path, "is_symlink", return_value=False),
            patch.object(pathlib.Path, "is_file", return_value=True),
            patch.object(proxy.subprocess, "run", return_value=completed),
        ):
            with self.assertRaises(RuntimeError):
                proxy.verify_runtime_identity()

    def test_startup_failures_use_bounded_safe_diagnostic_codes(self):
        self.assertEqual(
            proxy.startup_failure_code(
                RuntimeError(
                    "The local inference runtime did not become ready within "
                    f"{proxy.MODEL_STARTUP_DEADLINE_SECONDS} seconds."
                )
            ),
            "runtime_startup_timeout",
        )
        self.assertEqual(proxy.MODEL_STARTUP_DEADLINE_SECONDS, 480)
        self.assertEqual(
            proxy.startup_failure_code(
                RuntimeError("The local inference runtime stopped before becoming ready.")
            ),
            "runtime_stopped_before_ready",
        )
        self.assertEqual(
            proxy.startup_failure_code(
                OSError(98, "fixture port collision with untrusted details")
            ),
            "port_in_use",
        )
        self.assertEqual(
            proxy.startup_failure_code(RuntimeError("synthetic private detail")),
            "startup_failed",
        )
        self.assertEqual(
            proxy.startup_failure_code(RuntimeError(
                "The private local inference API did not become healthy within the startup deadline."
            )),
            "private_api_health_timeout",
        )

    def test_workflow_probe_reports_starting_until_the_private_api_is_ready(self):
        proxy.WORKFLOW_READY.clear()
        server = HTTPServer(("127.0.0.1", 0), proxy.WorkflowReadinessHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{server.server_port}"
        try:
            with self.assertRaises(urllib.error.HTTPError) as starting:
                HTTP.open(base_url + "/healthz", timeout=2)
            self.assertEqual(starting.exception.code, 503)
            self.assertEqual(
                __import__("json").load(starting.exception),
                {"status": "starting"},
            )
            proxy.WORKFLOW_READY.set()
            with HTTP.open(base_url + "/healthz", timeout=2) as ready:
                self.assertEqual(ready.status, 200)
                self.assertEqual(__import__("json").load(ready), {"status": "ready"})
            with self.assertRaises(urllib.error.HTTPError) as api_not_found:
                HTTP.open(base_url + "/v1/models", timeout=2)
            self.assertEqual(api_not_found.exception.code, 404)
        finally:
            proxy.WORKFLOW_READY.clear()
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_workflow_readiness_waits_for_the_exact_private_api_identity(self):
        class HealthHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.server.calls += 1
                if self.server.calls == 1:
                    status = 503
                    payload = {"status": "starting"}
                else:
                    status = 200
                    payload = {
                        "status": "healthy",
                        "model": "unapproved-model" if self.server.mismatch else proxy.MODEL,
                        "contextLimit": proxy.CONTEXT_LIMIT,
                    }
                body = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, _format, *_args):
                return

        server = HTTPServer(("127.0.0.1", 0), HealthHandler)
        server.calls = 0
        server.mismatch = False
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(proxy, "PROXY_HOST", "127.0.0.1"), patch.object(
                proxy, "PROXY_PORT", server.server_port
            ):
                proxy.wait_for_private_api_health(timeout_seconds=1)
                self.assertGreaterEqual(server.calls, 2)

                server.calls = 1
                server.mismatch = True
                with self.assertRaisesRegex(RuntimeError, "did not become healthy"):
                    proxy.wait_for_private_api_health(timeout_seconds=0.2)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


class LocalModelEndpointLifecycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (
            proxy.LLAMA_SERVER.is_file()
            and proxy.MODEL_FILE.is_file()
            and proxy.MMPROJ_FILE.is_file()
        ):
            raise unittest.SkipTest(
                "Lifecycle integration needs the separately installed pinned local model."
            )

    def setUp(self):
        for port in (8008, 11434, 11435):
            with socket.socket() as listener:
                try:
                    listener.bind(("127.0.0.1", port))
                except OSError:
                    self.skipTest(f"Loopback port {port} is already in use.")
        self.process = None
        self.environment = os.environ.copy()
        self.addCleanup(self.stop_endpoint)

    @staticmethod
    def listener_rows():
        rows = []
        for line in pathlib.Path("/proc/net/tcp").read_text().splitlines()[1:]:
            fields = line.split()
            if len(fields) < 4 or fields[3] != "0A":
                continue
            address, port_text = fields[1].split(":")
            port = int(port_text, 16)
            if port in {8008, 11434, 11435}:
                rows.append((port, address))
        return sorted(rows)

    def wait_for_health(self, timeout=570):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.process is None or self.process.poll() is not None:
                self.fail("The configured evaluator workflow command exited during startup.")
            try:
                with HTTP.open(ENDPOINT_URL, timeout=2) as response:
                    health = __import__("json").load(response)
                if (
                    response.status == 200
                    and health.get("status") == "healthy"
                    and health.get("model") == proxy.MODEL
                    and health.get("contextLimit") == proxy.CONTEXT_LIMIT
                ):
                    return
            except (OSError, urllib.error.URLError, ValueError):
                pass
            time.sleep(0.5)
        self.fail("The evaluator did not become healthy within its startup deadline.")

    def start_workflow_command(self):
        _config, workflow = configured_evaluator_workflow()
        command = shlex.split(workflow["tasks"][0]["args"])
        self.process = subprocess.Popen(
            command,
            cwd=WORKSPACE_ROOT,
            env=self.environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        self.wait_for_health()
        with HTTP.open(WORKFLOW_PROBE_URL, timeout=2) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(__import__("json").load(response), {"status": "ready"})
        with self.assertRaises(urllib.error.HTTPError) as not_found:
            HTTP.open("http://127.0.0.1:8008/v1/models", timeout=2)
        self.assertEqual(not_found.exception.code, 404)

    def stop_endpoint(self):
        if self.process is None:
            return
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.process = None

    def test_workflow_command_starts_serves_stops_and_recovers_without_shell_daemon(self):
        app_health = HTTP.open(APP_HEALTH_URL, timeout=4)
        with app_health:
            self.assertEqual(app_health.status, 200)

        self.start_workflow_command()
        self.assertEqual(
            self.listener_rows(),
            [(8008, "00000000"), (11434, "0100007F"), (11435, "0100007F")],
        )
        app_health = HTTP.open(APP_HEALTH_URL, timeout=4)
        with app_health:
            self.assertEqual(app_health.status, 200)

        first_pid = self.process.pid
        self.stop_endpoint()
        self.assertEqual(self.listener_rows(), [])
        self.start_workflow_command()
        self.assertNotEqual(self.process.pid, first_pid)
        self.assertEqual(
            self.listener_rows(),
            [(8008, "00000000"), (11434, "0100007F"), (11435, "0100007F")],
        )
        app_health = HTTP.open(APP_HEALTH_URL, timeout=4)
        with app_health:
            self.assertEqual(app_health.status, 200)


if __name__ == "__main__":
    unittest.main()
