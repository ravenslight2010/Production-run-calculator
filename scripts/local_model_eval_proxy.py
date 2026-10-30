#!/usr/bin/env python3
"""Run a private, bounded OpenAI-compatible gateway in front of pinned llama.cpp."""

from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import threading
import time
import re
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, build_opener, urlopen

PROXY_HOST = "127.0.0.1"
PROXY_PORT = 11434
WORKFLOW_READY_HOST = "127.0.0.1"
WORKFLOW_READY_PORT = 8008
MODEL_SERVER_HOST = "127.0.0.1"
MODEL_SERVER_PORT = 11435
MODEL_SERVER_BASE_URL = f"http://{MODEL_SERVER_HOST}:{MODEL_SERVER_PORT}"
MODEL = "qwen3.5-9b-q3_k_m"
MODEL_FILE_SHA256 = "36c110646c21b365714c0a7f0d512228276ba0e20b7a9187e7817b8f70fde58e"
MMPROJ_FILE_SHA256 = "97f420245a85ce129bb764e86a5e21e27d782fe6d6056c6839b9c5fdb8f38289"
CONTEXT_LIMIT = 4096
MAX_OUTPUT_TOKENS = 256
REQUEST_DEADLINE_SECONDS = 180
MODEL_STARTUP_DEADLINE_SECONDS = 480
PRIVATE_API_STARTUP_DEADLINE_SECONDS = 10
MAX_REQUEST_BYTES = 8 * 1024 * 1024
STATUS_MARKER = b"\n__LOCAL_MODEL_HTTP_STATUS__"
WORKFLOW_READY = threading.Event()
WORKSPACE_ROOT = Path(__file__).resolve().parents[1]
EVAL_HOME = WORKSPACE_ROOT / ".local" / "share" / "local-ai-eval"
RUNTIME_ROOT = EVAL_HOME / "runtime" / "ollama-0.40.5"
MODEL_ROOT = EVAL_HOME / "models" / "qwen3.5-9b-q3_k_m"
LLAMA_SERVER = RUNTIME_ROOT / "lib" / "ollama" / "llama-server"
MODEL_FILE = MODEL_ROOT / "Qwen3.5-9B.Q3_K_M.gguf"
MMPROJ_FILE = MODEL_ROOT / "Qwen3.5-9B.mmproj-f16.gguf"
LLAMA_SERVER_COMMIT = "620d2225c"
RUNTIME_VERSION = "0.40.5"

REQUEST_SLOT = threading.BoundedSemaphore(1)


class ProxyError(Exception):
    def __init__(self, status: int, message: str, error_type: str = "invalid_request_error"):
        super().__init__(message)
        self.status = status
        self.message = message
        self.error_type = error_type


def error_body(message: str, error_type: str) -> bytes:
    return json.dumps(
        {"error": {"message": message, "type": error_type}},
        separators=(",", ":"),
    ).encode("utf-8")


def validate_completion_body(raw_body: bytes) -> bytes:
    if len(raw_body) > MAX_REQUEST_BYTES:
        raise ProxyError(413, "Request body exceeds the local endpoint size limit.")

    try:
        payload = json.loads(raw_body)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ProxyError(400, "Request body must be valid JSON.") from None

    if not isinstance(payload, dict):
        raise ProxyError(400, "Request body must be a JSON object.")
    if payload.get("model") != MODEL:
        raise ProxyError(400, f"Only the approved model {MODEL} is available.")
    if not isinstance(payload.get("messages"), list) or not payload["messages"]:
        raise ProxyError(400, "At least one chat message is required.")
    if payload.get("stream") is True:
        raise ProxyError(400, "Streaming is disabled for this bounded evaluation endpoint.")

    if any(key in payload for key in ("tools", "tool_choice", "functions", "function_call")):
        raise ProxyError(400, "Tool and function calls are disabled on this evaluation endpoint.")

    requested_context = payload.pop("num_ctx", None)
    if requested_context is not None and (
        isinstance(requested_context, bool)
        or not isinstance(requested_context, int)
        or requested_context < 1
        or requested_context > CONTEXT_LIMIT
    ):
        raise ProxyError(400, f"Context must be between 1 and {CONTEXT_LIMIT} tokens.")
    if "options" in payload:
        options = payload.pop("options")
        if not isinstance(options, dict):
            raise ProxyError(400, "Request options must be an object.")
        option_context = options.get("num_ctx")
        if option_context is not None and (
            isinstance(option_context, bool)
            or not isinstance(option_context, int)
            or option_context < 1
            or option_context > CONTEXT_LIMIT
        ):
            raise ProxyError(400, f"Context must be between 1 and {CONTEXT_LIMIT} tokens.")
        if set(options) - {"num_ctx"}:
            raise ProxyError(400, "Only the fixed local inference options are supported.")

    if "max_tokens" in payload and "max_completion_tokens" in payload:
        raise ProxyError(400, "Specify only one output token limit.")
    requested_tokens = payload.pop("max_completion_tokens", payload.get("max_tokens"))
    if requested_tokens is None:
        requested_tokens = MAX_OUTPUT_TOKENS
    if (
        isinstance(requested_tokens, bool)
        or not isinstance(requested_tokens, int)
        or requested_tokens < 1
        or requested_tokens > MAX_OUTPUT_TOKENS
    ):
        raise ProxyError(400, f"Output must be between 1 and {MAX_OUTPUT_TOKENS} tokens.")
    payload["max_tokens"] = requested_tokens

    messages = payload["messages"]
    if len(messages) > 64:
        raise ProxyError(400, "Too many chat messages.")
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in {"system", "user", "assistant"}:
            raise ProxyError(400, "Messages must use system, user, or assistant roles.")
        content = message.get("content")
        if isinstance(content, str):
            continue
        if not isinstance(content, list):
            raise ProxyError(400, "Message content must be text or a bounded text/image list.")
        for part in content:
            if not isinstance(part, dict):
                raise ProxyError(400, "Message content parts must be objects.")
            if part.get("type") == "text" and isinstance(part.get("text"), str):
                continue
            if part.get("type") == "image_url":
                image_url = part.get("image_url")
                url = image_url.get("url") if isinstance(image_url, dict) else None
                if not isinstance(url, str) or not re.fullmatch(
                    r"data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*",
                    url,
                ):
                    raise ProxyError(400, "Images must be bounded PNG, JPEG, or WebP data URLs.")
                continue
            raise ProxyError(400, "Only text and approved inline images are supported.")

    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def _curl(
    method: str,
    path: str,
    body: bytes | None,
    timeout_seconds: int,
) -> tuple[int, bytes]:
    command = [
        "curl",
        "--silent",
        "--show-error",
        "--connect-timeout",
        "2",
        "--max-time",
        str(timeout_seconds),
        "--request",
        method,
        "--header",
        "Accept: application/json",
        "--write-out",
        STATUS_MARKER.decode("ascii") + "%{http_code}",
    ]
    if body is not None:
        command.extend(
            [
                "--header",
                "Content-Type: application/json",
                "--data-binary",
                "@-",
            ]
        )
    command.append(f"{MODEL_SERVER_BASE_URL}{path}")

    try:
        result = subprocess.run(
            command,
            input=body,
            capture_output=True,
            check=False,
            timeout=timeout_seconds + 2,
        )
    except subprocess.TimeoutExpired:
        return 504, error_body(
            f"The local model request exceeded its {timeout_seconds}-second deadline.",
            "timeout_error",
        )

    response, marker, status_text = result.stdout.rpartition(STATUS_MARKER)
    if result.returncode == 28:
        return 504, error_body(
            f"The local model request exceeded its {timeout_seconds}-second deadline.",
            "timeout_error",
        )
    if result.returncode != 0 or not marker or not status_text.isdigit():
        return 502, error_body(
            "The local model endpoint is temporarily unavailable.",
            "upstream_error",
        )

    status = int(status_text)
    if status < 100 or status > 599:
        return 502, error_body(
            "The local model endpoint returned an invalid status.",
            "upstream_error",
        )
    if status >= 400:
        safe_status = status if status in {400, 404, 429, 500, 503, 504} else 502
        return safe_status, error_body(
            "The local model endpoint could not complete the request.",
            "upstream_error",
        )
    return status, response


def forward_completion(body: bytes) -> tuple[int, bytes]:
    return _curl(
        "POST",
        "/v1/chat/completions",
        body,
        REQUEST_DEADLINE_SECONDS,
    )


def forward_model_list() -> tuple[int, bytes]:
    return _curl("GET", "/v1/models", None, 5)


def forward_health() -> tuple[int, bytes]:
    status, raw_models = forward_model_list()
    if status != 200:
        return 503, error_body("The pinned local model is not ready.", "unavailable_error")
    try:
        verify_model_identity(raw_models)
    except RuntimeError:
        return 503, error_body("The pinned local model is not ready.", "unavailable_error")
    return 200, json.dumps(
        {"status": "healthy", "model": MODEL, "contextLimit": CONTEXT_LIMIT},
        separators=(",", ":"),
    ).encode("utf-8")


def wait_for_private_api_health(timeout_seconds: float = PRIVATE_API_STARTUP_DEADLINE_SECONDS) -> None:
    """Wait until the loopback gateway itself reports the pinned healthy identity."""
    deadline = time.monotonic() + max(0, timeout_seconds)
    opener = build_opener(ProxyHandler({}))
    while time.monotonic() < deadline:
        try:
            with opener.open(
                f"http://{PROXY_HOST}:{PROXY_PORT}/healthz",
                timeout=1,
            ) as response:
                payload = json.loads(response.read())
            if (
                response.status == 200
                and isinstance(payload, dict)
                and payload.get("status") == "healthy"
                and payload.get("model") == MODEL
                and payload.get("contextLimit") == CONTEXT_LIMIT
            ):
                return
        except HTTPError as error:
            # Drain the small safe health error before retrying so the server sees
            # a completed response rather than a cancelled socket write.
            error.read(512)
        except (OSError, URLError, UnicodeDecodeError, json.JSONDecodeError):
            pass
        time.sleep(min(0.1, max(0, deadline - time.monotonic())))
    raise RuntimeError(
        "The private local inference API did not become healthy within the startup deadline."
    )


def _write_response_body(handler: BaseHTTPRequestHandler, body: bytes) -> None:
    try:
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionResetError):
        # A caller may cancel while a bounded readiness/error response is being sent.
        handler.close_connection = True


class EndpointHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LocalModelEvalProxy/1"

    def log_message(self, _format: str, *_args: object) -> None:
        # Never write request paths, prompt text, response text, or headers to logs.
        return

    def _send_json(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        _write_response_body(self, body)
        self.close_connection = True


    def do_GET(self) -> None:
        if self.path not in {"/v1/models", "/healthz"}:
            self._send_json(404, error_body("Route not found.", "invalid_request_error"))
            return

        # Health probes are part of app configuration refresh and must remain
        # available while the single inference slot is occupied.
        if self.path == "/healthz":
            status, body = forward_health()
            self._send_json(status, body)
            return

        if not REQUEST_SLOT.acquire(blocking=False):
            self._send_json(
                429,
                error_body(
                    "One local model request is already in progress.",
                    "rate_limit_error",
                ),
            )
            return

        try:
            status, body = forward_model_list()
            self._send_json(status, body)
        finally:
            REQUEST_SLOT.release()

    def do_POST(self) -> None:
        if self.path != "/v1/chat/completions":
            self._send_json(404, error_body("Route not found.", "invalid_request_error"))
            return

        if not REQUEST_SLOT.acquire(blocking=False):
            self._send_json(
                429,
                error_body(
                    "One local model request is already in progress.",
                    "rate_limit_error",
                ),
            )
            return

        try:
            if self.headers.get("Transfer-Encoding"):
                self._send_json(
                    400,
                    error_body("Chunked request bodies are not supported.", "invalid_request_error"),
                )
                return

            content_type = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip()
            if content_type.lower() != "application/json":
                self._send_json(
                    415,
                    error_body("Content-Type must be application/json.", "invalid_request_error"),
                )
                return

            try:
                content_length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                self._send_json(
                    411,
                    error_body("A valid Content-Length header is required.", "invalid_request_error"),
                )
                return

            if content_length < 1:
                self._send_json(
                    400,
                    error_body("Request body must not be empty.", "invalid_request_error"),
                )
                return
            if content_length > MAX_REQUEST_BYTES:
                self._send_json(
                    413,
                    error_body("Request body exceeds the local endpoint size limit.", "invalid_request_error"),
                )
                return

            try:
                raw_body = self.rfile.read(content_length)
            except OSError:
                self._send_json(
                    400,
                    error_body("Request body was incomplete.", "invalid_request_error"),
                )
                return
            if len(raw_body) != content_length:
                self._send_json(
                    400,
                    error_body("Request body was incomplete.", "invalid_request_error"),
                )
                return

            try:
                normalized_body = validate_completion_body(raw_body)
            except ProxyError as error:
                self._send_json(error.status, error_body(error.message, error.error_type))
                return

            status, response = forward_completion(normalized_body)
            self._send_json(status, response)
        finally:
            REQUEST_SLOT.release()


class WorkflowReadinessHandler(BaseHTTPRequestHandler):
    """Local-only workflow liveness probe; never carries inference traffic."""

    protocol_version = "HTTP/1.1"
    server_version = "LocalAIReadiness/1"

    def do_GET(self) -> None:
        if self.path != "/healthz":
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        ready = WORKFLOW_READY.is_set()
        payload = b'{"status":"ready"}\n' if ready else b'{"status":"starting"}\n'
        self.send_response(200 if ready else 503)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        _write_response_body(self, payload)

    def do_HEAD(self) -> None:
        if self.path != "/healthz":
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        ready = WORKFLOW_READY.is_set()
        payload = b'{"status":"ready"}\n' if ready else b'{"status":"starting"}\n'
        self.send_response(200 if ready else 503)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()

    def log_message(self, _format: str, *_args: object) -> None:
        return


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_model_files() -> None:
    expected_files = (
        (MODEL_FILE, MODEL_FILE_SHA256, 4_616_185_088),
        (MMPROJ_FILE, MMPROJ_FILE_SHA256, 918_165_952),
    )
    for path, expected_digest, expected_size in expected_files:
        if path.is_symlink() or not path.is_file() or path.stat().st_size != expected_size:
            raise RuntimeError("A pinned local model artifact is missing or has an invalid size.")
        if _sha256(path) != expected_digest:
            raise RuntimeError("A pinned local model artifact failed its SHA-256 check.")


def verify_runtime_identity() -> None:
    if LLAMA_SERVER.is_symlink() or not LLAMA_SERVER.is_file():
        raise RuntimeError("The pinned local inference runtime is missing.")
    try:
        result = subprocess.run(
            [str(LLAMA_SERVER), "--version"],
            capture_output=True,
            check=False,
            timeout=10,
            text=True,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("The pinned local inference runtime could not be checked.") from None
    identity = result.stdout + result.stderr
    if result.returncode != 0 or LLAMA_SERVER_COMMIT not in identity:
        raise RuntimeError("The local inference runtime does not match the pinned build.")


def available_cpu_threads() -> int:
    try:
        quota, period = Path("/sys/fs/cgroup/cpu.max").read_text().split()
        if quota != "max":
            return max(1, min(8, int(quota) // int(period)))
    except (OSError, ValueError, ZeroDivisionError):
        pass
    return max(1, min(8, os.cpu_count() or 1))


def server_command() -> list[str]:
    return [
        str(LLAMA_SERVER),
        "--model", str(MODEL_FILE),
        "--mmproj", str(MMPROJ_FILE),
        "--host", MODEL_SERVER_HOST,
        "--port", str(MODEL_SERVER_PORT),
        "--alias", MODEL,
        "--ctx-size", str(CONTEXT_LIMIT),
        "--predict", str(MAX_OUTPUT_TOKENS),
        "--threads", str(available_cpu_threads()),
        "--threads-batch", str(available_cpu_threads()),
        "--parallel", "1",
        "--n-gpu-layers", "0",
        "--no-webui",
        "--no-webui-mcp-proxy",
        "--reasoning", "off",
        "--reasoning-format", "none",
        "--timeout", str(REQUEST_DEADLINE_SECONDS),
    ]


def _wait_for_model_server(process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + MODEL_STARTUP_DEADLINE_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("The local inference runtime stopped before becoming ready.")
        try:
            with urlopen(f"{MODEL_SERVER_BASE_URL}/health", timeout=1) as response:
                if response.status != 200:
                    raise RuntimeError("The local inference runtime health check failed.")
            with urlopen(f"{MODEL_SERVER_BASE_URL}/v1/models", timeout=3) as response:
                verify_model_identity(response.read())
            return
        except (OSError, URLError):
            time.sleep(0.25)
    raise RuntimeError(
        f"The local inference runtime did not become ready within {MODEL_STARTUP_DEADLINE_SECONDS} seconds."
    )


def verify_model_identity(raw_models: bytes) -> None:
    try:
        models = json.loads(raw_models)["data"]
    except (KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
        raise RuntimeError("The local inference runtime returned an invalid model list.") from None
    if not isinstance(models, list) or not any(
        isinstance(model, dict) and model.get("id") == MODEL for model in models
    ):
        raise RuntimeError("The local inference runtime does not expose the pinned model identity.")


def startup_failure_code(error: Exception) -> str:
    """Map fixed startup failures to safe diagnostic codes without logging details."""
    if isinstance(error, OSError):
        if error.errno == 98:
            return "port_in_use"
        if error.errno == 99:
            return "address_unavailable"
        return "startup_io_error"
    if isinstance(error, RuntimeError):
        messages = {
            "A pinned local model artifact is missing or has an invalid size.": "model_artifact_invalid",
            "A pinned local model artifact failed its SHA-256 check.": "model_digest_mismatch",
            "The pinned local inference runtime is missing.": "runtime_missing",
            "The pinned local inference runtime could not be checked.": "runtime_check_failed",
            "The local inference runtime does not match the pinned build.": "runtime_identity_mismatch",
            "The local inference runtime stopped before becoming ready.": "runtime_stopped_before_ready",
            "The local inference runtime health check failed.": "runtime_health_failed",
            f"The local inference runtime did not become ready within {MODEL_STARTUP_DEADLINE_SECONDS} seconds.": "runtime_startup_timeout",
            "The local inference runtime returned an invalid model list.": "runtime_model_list_invalid",
            "The local inference runtime does not expose the pinned model identity.": "runtime_model_identity_mismatch",
            "The private local inference API did not become healthy within the startup deadline.": "private_api_health_timeout",
        }
        return messages.get(str(error), "startup_failed")
    return "startup_failed"


def main() -> int:
    if shutil.which("curl") is None:
        print("curl must be installed before starting this endpoint.", file=sys.stderr)
        return 1

    model_server: subprocess.Popen[bytes] | None = None
    server: ThreadingHTTPServer | None = None
    server_thread: threading.Thread | None = None
    readiness_server: HTTPServer | None = None
    readiness_thread: threading.Thread | None = None

    def terminate(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, terminate)
    signal.signal(signal.SIGTERM, terminate)
    WORKFLOW_READY.clear()

    try:
        readiness_server = HTTPServer(
            (WORKFLOW_READY_HOST, WORKFLOW_READY_PORT),
            WorkflowReadinessHandler,
        )
        readiness_server.request_queue_size = 2
        readiness_thread = threading.Thread(
            target=readiness_server.serve_forever,
            kwargs={"poll_interval": 0.25},
            name="local-model-workflow-readiness",
            daemon=True,
        )
        readiness_thread.start()
        print("Private local evaluator is starting.")
        verify_runtime_identity()
        verify_model_files()
        model_server = subprocess.Popen(
            server_command(),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        _wait_for_model_server(model_server)
        server = ThreadingHTTPServer((PROXY_HOST, PROXY_PORT), EndpointHandler)
        server.daemon_threads = True
        server_thread = threading.Thread(
            target=server.serve_forever,
            kwargs={"poll_interval": 0.25},
            name="private-local-model-api",
            daemon=True,
        )
        server_thread.start()
        wait_for_private_api_health()
        WORKFLOW_READY.set()
        print(f"Private local model endpoint ready at http://{PROXY_HOST}:{PROXY_PORT}/v1")
        server_thread.join()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        # Stable codes aid troubleshooting without exposing paths or raw details.
        print(f"Local model endpoint failed to start: {startup_failure_code(error)}", file=sys.stderr)
        return 1
    finally:
        WORKFLOW_READY.clear()
        if server is not None:
            if server_thread is not None and server_thread.is_alive():
                server.shutdown()
            server.server_close()
            if server_thread is not None:
                server_thread.join(timeout=2)
        if readiness_server is not None:
            if readiness_thread is not None and readiness_thread.is_alive():
                readiness_server.shutdown()
            readiness_server.server_close()
        if model_server is not None and model_server.poll() is None:
            model_server.terminate()
            try:
                model_server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                model_server.kill()
                model_server.wait()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
