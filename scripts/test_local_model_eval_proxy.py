import http.client
import io
import json
import subprocess
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import local_model_eval_proxy as proxy


def valid_body() -> bytes:
    return json.dumps(
        {
            "model": "qwen3:8b",
            "messages": [{"role": "user", "content": "synthetic test"}],
            "max_tokens": 32,
        }
    ).encode("utf-8")


class ProxyValidationTests(unittest.TestCase):
    def test_context_is_fixed_at_approved_limit(self):
        raw = json.dumps(
            {
                "model": "qwen3:8b",
                "messages": [{"role": "user", "content": "synthetic test"}],
                "options": {"num_ctx": 8192, "temperature": 0},
            }
        ).encode("utf-8")

        normalized = json.loads(proxy.validate_completion_body(raw))

        self.assertNotIn("num_ctx", normalized["options"])
        self.assertEqual(normalized["model"], "qwen3:8b")

    def test_rejects_nonapproved_model_streaming_and_excess_context(self):
        invalid_requests = [
            {"model": "another-model", "messages": []},
            {"model": "qwen3:8b", "messages": [], "stream": True},
            {
                "model": "qwen3:8b",
                "messages": [],
                "options": {"num_ctx": 32769},
            },
            {"model": "qwen3:8b", "messages": [], "num_ctx": 32769},
        ]

        for request in invalid_requests:
            with self.subTest(request=request):
                with self.assertRaises(proxy.ProxyError):
                    proxy.validate_completion_body(json.dumps(request).encode("utf-8"))

    def test_oversized_body_is_rejected(self):
        with self.assertRaises(proxy.ProxyError) as raised:
            proxy.validate_completion_body(b" " * (proxy.MAX_REQUEST_BYTES + 1))

        self.assertEqual(raised.exception.status, 413)

    def test_completion_budget_is_capped_to_context_limit(self):
        raw = json.dumps(
            {
                "model": "qwen3:8b",
                "messages": [{"role": "user", "content": "synthetic test"}],
                "max_completion_tokens": 65536,
            }
        ).encode("utf-8")

        normalized = json.loads(proxy.validate_completion_body(raw))

        self.assertEqual(normalized["max_completion_tokens"], 32768)

    def test_rejects_requests_without_chat_messages(self):
        with self.assertRaises(proxy.ProxyError):
            proxy.validate_completion_body(b'{"model":"qwen3:8b","messages":[]}')

    def test_model_identity_must_match_the_pinned_digest(self):
        approved = json.dumps(
            {
                "models": [
                    {"name": "qwen3:8b", "digest": proxy.MODEL_DIGEST},
                ]
            }
        ).encode("utf-8")
        changed = json.dumps(
            {
                "models": [
                    {"name": "qwen3:8b", "digest": "0" * 64},
                ]
            }
        ).encode("utf-8")

        proxy.verify_model_identity(approved)
        with self.assertRaises(RuntimeError):
            proxy.verify_model_identity(changed)


class ProxyForwardingTests(unittest.TestCase):
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
        self.assertEqual(command[command.index("--max-time") + 1], "120")
        self.assertEqual(run.call_args.kwargs["timeout"], 122)

    def test_timeout_returns_safe_504_without_forwarding_details(self):
        with patch.object(
            proxy.subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired("curl", 122),
        ):
            status, body = proxy.forward_completion(valid_body())

        self.assertEqual(status, 504)
        self.assertIn(b"120-second deadline", body)
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


if __name__ == "__main__":
    unittest.main()
