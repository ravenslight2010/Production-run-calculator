import http.client
import io
import json
import subprocess
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import Mock, patch

import local_model_eval_proxy as proxy


def valid_body() -> bytes:
    return json.dumps(
        {
            "model": "qwen3.5-9b-q3_k_m",
            "messages": [{"role": "user", "content": "synthetic test"}],
            "max_tokens": 32,
        }
    ).encode("utf-8")


class ProxyValidationTests(unittest.TestCase):
    def test_context_is_fixed_at_approved_limit(self):
        raw = json.dumps(
            {
                "model": "qwen3.5-9b-q3_k_m",
                "messages": [{"role": "user", "content": "synthetic test"}],
                "num_ctx": 4096,
            }
        ).encode("utf-8")

        normalized = json.loads(proxy.validate_completion_body(raw))

        self.assertNotIn("num_ctx", normalized)
        self.assertEqual(normalized["model"], proxy.MODEL)
        self.assertEqual(normalized["max_tokens"], proxy.MAX_OUTPUT_TOKENS)

    def test_rejects_nonapproved_model_streaming_and_excess_context(self):
        invalid_requests = [
            {"model": "another-model", "messages": []},
            {"model": "qwen3.5-9b-q3_k_m", "messages": [], "stream": True},
            {
                "model": "qwen3.5-9b-q3_k_m",
                "messages": [],
                "num_ctx": 4097,
            },
            {"model": "qwen3.5-9b-q3_k_m", "messages": [], "num_ctx": 4097},
        ]

        for request in invalid_requests:
            with self.subTest(request=request):
                with self.assertRaises(proxy.ProxyError):
                    proxy.validate_completion_body(json.dumps(request).encode("utf-8"))

    def test_oversized_body_is_rejected(self):
        with self.assertRaises(proxy.ProxyError) as raised:
            proxy.validate_completion_body(b" " * (proxy.MAX_REQUEST_BYTES + 1))

        self.assertEqual(raised.exception.status, 413)

    def test_completion_budget_is_normalized_and_oversize_is_rejected(self):
        raw = json.dumps(
            {
                "model": "qwen3.5-9b-q3_k_m",
                "messages": [{"role": "user", "content": "synthetic test"}],
                "max_completion_tokens": 32,
            }
        ).encode("utf-8")

        normalized = json.loads(proxy.validate_completion_body(raw))

        self.assertEqual(normalized["max_tokens"], 32)
        self.assertNotIn("max_completion_tokens", normalized)
        oversized = json.dumps(
            {
                "model": proxy.MODEL,
                "messages": [{"role": "user", "content": "synthetic test"}],
                "max_tokens": proxy.MAX_OUTPUT_TOKENS + 1,
            }
        ).encode()
        with self.assertRaises(proxy.ProxyError):
            proxy.validate_completion_body(oversized)

    def test_rejects_requests_without_chat_messages(self):
        with self.assertRaises(proxy.ProxyError):
            proxy.validate_completion_body(b'{"model":"qwen3.5-9b-q3_k_m","messages":[]}')

    def test_model_identity_must_match_the_pinned_digest(self):
        approved = json.dumps(
            {
                "data": [{"id": proxy.MODEL}]
            }
        ).encode("utf-8")
        changed = json.dumps(
            {
                "data": [{"id": "another-model"}]
            }
        ).encode("utf-8")

        proxy.verify_model_identity(approved)
        with self.assertRaises(RuntimeError):
            proxy.verify_model_identity(changed)

    def test_rejects_remote_images_and_untrusted_tool_calls(self):
        requests = [
            {
                "model": proxy.MODEL,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": "https://example.invalid/image.png"},
                            }
                        ],
                    }
                ],
            },
            {
                "model": proxy.MODEL,
                "messages": [{"role": "user", "content": "synthetic"}],
                "tools": [{"type": "function"}],
            },
        ]
        for request in requests:
            with self.subTest(request=request):
                with self.assertRaises(proxy.ProxyError):
                    proxy.validate_completion_body(json.dumps(request).encode())

    def test_accepts_only_inline_synthetic_images(self):
        request = {
            "model": proxy.MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "synthetic"},
                        {
                            "type": "image_url",
                            "image_url": {"url": "data:image/png;base64,aGVsbG8="},
                        },
                    ],
                }
            ],
        }
        normalized = json.loads(
            proxy.validate_completion_body(json.dumps(request).encode())
        )
        self.assertEqual(normalized["messages"], request["messages"])


class ProxyForwardingTests(unittest.TestCase):
    def test_client_disconnect_is_closed_without_logging_response_details(self):
        handler = Mock()
        handler.close_connection = False
        handler.wfile.write.side_effect = BrokenPipeError()

        proxy._write_response_body(handler, b"synthetic readiness body")

        self.assertTrue(handler.close_connection)
        handler.wfile.write.assert_called_once_with(b"synthetic readiness body")

    def test_http_access_logging_does_not_emit_request_or_response_text(self):
        handler = object.__new__(proxy.EndpointHandler)
        with patch("sys.stderr", new_callable=io.StringIO) as stderr:
            handler.log_message("%s", "synthetic prompt and response sentinel")

        self.assertEqual(stderr.getvalue(), "")

    def test_forwarder_has_an_absolute_120_second_deadline(self):
        marker = proxy.STATUS_MARKER + b"200"
        completed = subprocess.CompletedProcess(
            args=["curl"],
            returncode=0,
            stdout=b'{"ok":true}' + marker,
            stderr=b"",
        )

        with patch.object(proxy.subprocess, "run", return_value=completed) as run:
            status, body = proxy.forward_completion(valid_body())

        self.assertEqual(status, 200)
        self.assertEqual(body, b'{"ok":true}')
        command = run.call_args.args[0]
        self.assertEqual(
            command[command.index("--max-time") + 1],
            str(proxy.REQUEST_DEADLINE_SECONDS),
        )
        self.assertEqual(
            run.call_args.kwargs["timeout"],
            proxy.REQUEST_DEADLINE_SECONDS + 2,
        )

    def test_timeout_returns_safe_504_without_forwarding_details(self):
        with patch.object(
            proxy.subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired("curl", 122),
        ):
            status, body = proxy.forward_completion(valid_body())

        self.assertEqual(status, 504)
        self.assertIn(
            f"{proxy.REQUEST_DEADLINE_SECONDS}-second deadline".encode(),
            body,
        )
        self.assertNotIn(b"synthetic test", body)

    def test_only_one_completion_request_is_in_flight(self):
        entered_upstream = threading.Event()
        release_upstream = threading.Event()
        first_result: dict[str, int] = {}

        def delayed_forward(_body: bytes) -> tuple[int, bytes]:
            entered_upstream.set()
            release_upstream.wait(timeout=2)
            return 200, b'{"ok":true}'

        server = ThreadingHTTPServer(("127.0.0.1", 0), proxy.EndpointHandler)
        server.daemon_threads = True
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()

        def post(result: dict[str, int]) -> None:
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
            connection.request(
                "POST",
                "/v1/chat/completions",
                body=valid_body(),
                headers={"Content-Type": "application/json"},
            )
            response = connection.getresponse()
            result["status"] = response.status
            response.read()
            connection.close()

        try:
            with patch.object(proxy, "forward_completion", side_effect=delayed_forward):
                first = threading.Thread(target=post, args=(first_result,))
                first.start()
                self.assertTrue(entered_upstream.wait(timeout=1))

                second_result: dict[str, int] = {}
                second = threading.Thread(target=post, args=(second_result,))
                second.start()
                second.join(timeout=3)
                release_upstream.set()
                first.join(timeout=3)
        finally:
            release_upstream.set()
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=3)

        self.assertEqual(second_result.get("status"), 429)
        self.assertEqual(first_result.get("status"), 200)

    def test_health_probe_remains_available_during_single_inference(self):
        entered_upstream = threading.Event()
        release_upstream = threading.Event()
        completion_result: dict[str, int] = {}

        def delayed_forward(_body: bytes) -> tuple[int, bytes]:
            entered_upstream.set()
            release_upstream.wait(timeout=2)
            return 200, b'{"ok":true}'

        server = ThreadingHTTPServer(("127.0.0.1", 0), proxy.EndpointHandler)
        server.daemon_threads = True
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()

        def post() -> None:
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
            connection.request(
                "POST",
                "/v1/chat/completions",
                body=valid_body(),
                headers={"Content-Type": "application/json"},
            )
            response = connection.getresponse()
            completion_result["status"] = response.status
            response.read()
            connection.close()

        try:
            with (
                patch.object(proxy, "forward_completion", side_effect=delayed_forward),
                patch.object(proxy, "forward_health", return_value=(200, b'{"status":"healthy"}')),
            ):
                completion = threading.Thread(target=post)
                completion.start()
                self.assertTrue(entered_upstream.wait(timeout=1))

                health_connection = http.client.HTTPConnection(
                    "127.0.0.1", server.server_port, timeout=3
                )
                health_connection.request("GET", "/healthz")
                health_response = health_connection.getresponse()
                self.assertEqual(health_response.status, 200)
                self.assertEqual(health_response.read(), b'{"status":"healthy"}')
                health_connection.close()

                release_upstream.set()
                completion.join(timeout=3)
        finally:
            release_upstream.set()
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=3)

        self.assertEqual(completion_result.get("status"), 200)


if __name__ == "__main__":
    unittest.main()
