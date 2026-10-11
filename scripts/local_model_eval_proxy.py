#!/usr/bin/env python3
"""Run a private, bounded OpenAI-compatible gateway in front of local Ollama."""

from __future__ import annotations

import json
import os
import signal
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.request import urlopen

PROXY_HOST = "127.0.0.1"
PROXY_PORT = 11434
OLLAMA_HOST = "127.0.0.1:11435"
OLLAMA_BASE_URL = f"http://{OLLAMA_HOST}"
MODEL = "qwen3:8b"
MODEL_DIGEST = "500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41"
CONTEXT_LIMIT = 32768
REQUEST_DEADLINE_SECONDS = 120
MAX_REQUEST_BYTES = 8 * 1024 * 1024
STATUS_MARKER = b"\n__LOCAL_MODEL_HTTP_STATUS__"

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

    requested_context = payload.pop("num_ctx", None)
    if requested_context is not None and (
        isinstance(requested_context, bool)
        or not isinstance(requested_context, int)
        or requested_context > CONTEXT_LIMIT
    ):
        raise ProxyError(400, f"Context cannot exceed {CONTEXT_LIMIT} tokens.")

    options = payload.get("options")
    if options is not None and not isinstance(options, dict):
        raise ProxyError(400, "Request options must be an object.")
    if isinstance(options, dict):
        requested_context = options.get("num_ctx")
        if requested_context is not None:
            if (
                isinstance(requested_context, bool)
                or not isinstance(requested_context, int)
                or requested_context > CONTEXT_LIMIT
            ):
                raise ProxyError(400, f"Context cannot exceed {CONTEXT_LIMIT} tokens.")
            # Do not allow callers to lower or raise the server's approved context.
            options = {key: value for key, value in options.items() if key != "num_ctx"}
            payload["options"] = options

    for token_limit in ("max_tokens", "max_completion_tokens"):
        requested_tokens = payload.get(token_limit)
        if requested_tokens is not None and (
            isinstance(requested_tokens, bool)
            or not isinstance(requested_tokens, int)
            or requested_tokens < 1
        ):
            raise ProxyError(400, f"{token_limit} must be between 1 and {CONTEXT_LIMIT}.")
        if requested_tokens is not None and requested_tokens > CONTEXT_LIMIT:
            payload[token_limit] = CONTEXT_LIMIT

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
    command.append(f"{OLLAMA_BASE_URL}{path}")

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
        self.wfile.write(body)
        self.close_connection = True

    def do_GET(self) -> None:
        if self.path != "/v1/models":
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


def _ollama_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment.update(
        {
            "OLLAMA_HOST": OLLAMA_HOST,
            "OLLAMA_NUM_PARALLEL": "1",
            "OLLAMA_MAX_QUEUE": "1",
            "OLLAMA_MAX_LOADED_MODELS": "1",
            "OLLAMA_CONTEXT_LENGTH": str(CONTEXT_LIMIT),
            "OLLAMA_KEEP_ALIVE": "5m",
            "OLLAMA_DEBUG": "0",
            "OLLAMA_MODELS": os.path.join(os.path.expanduser("~"), ".ollama", "models"),
        }
    )
    return environment


def _wait_for_ollama(process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Ollama stopped before becoming ready.")
        try:
            with urlopen(f"{OLLAMA_BASE_URL}/api/version", timeout=1):
                pass
            with urlopen(f"{OLLAMA_BASE_URL}/api/tags", timeout=2) as response:
                verify_model_identity(response.read())
            return
        except (OSError, URLError):
            time.sleep(0.25)
    raise RuntimeError("Ollama did not become ready within 45 seconds.")


def verify_model_identity(raw_tags: bytes) -> None:
    try:
        models = json.loads(raw_tags)["models"]
    except (KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
        raise RuntimeError("Ollama returned an invalid model list.") from None

    approved = next(
        (model for model in models if isinstance(model, dict) and model.get("name") == MODEL),
        None,
    )
    if approved is None or approved.get("digest") != MODEL_DIGEST:
        raise RuntimeError("The installed Qwen3 tag does not match the approved model digest.")


def main() -> int:
    if not shutil.which("ollama") or not shutil.which("curl"):
        print("Ollama and curl must be installed before starting this endpoint.", file=sys.stderr)
        return 1

    def terminate(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, terminate)
    signal.signal(signal.SIGTERM, terminate)

    ollama_process = subprocess.Popen(
        ["ollama", "serve"],
        env=_ollama_environment(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    server: ThreadingHTTPServer | None = None
    try:
        _wait_for_ollama(ollama_process)
        server = ThreadingHTTPServer((PROXY_HOST, PROXY_PORT), EndpointHandler)
        server.daemon_threads = True
        print(f"Private local model endpoint ready at http://{PROXY_HOST}:{PROXY_PORT}/v1")
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    except Exception as error:
        # Keep diagnostics bounded; never include request or model payloads.
        print(f"Local model endpoint failed to start: {type(error).__name__}", file=sys.stderr)
        return 1
    finally:
        if server is not None:
            server.server_close()
        if ollama_process.poll() is None:
            ollama_process.terminate()
            try:
                ollama_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                ollama_process.kill()
                ollama_process.wait()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
