import hashlib
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import local_model_eval_setup as setup


class ResourcePreflightTests(unittest.TestCase):
    def good_resources(self):
        return {
            "system": "Linux",
            "machine": "x86_64",
            "cpu_threads": 8,
            "memory_limit_bytes": 16 * 1024**3,
            "memory_available_bytes": 10 * 1024**3,
            "disk_free_bytes": 40 * 1024**3,
        }

    def test_accepts_measured_cpu_workspace_with_headroom(self):
        setup.check_resources(self.good_resources())

    def test_rejects_incompatible_or_underprovisioned_host(self):
        cases = (
            {"system": "Darwin"},
            {"machine": "aarch64"},
            {"cpu_threads": 3},
            {"memory_limit_bytes": 11 * 1024**3},
            {"memory_available_bytes": 7 * 1024**3},
            {"disk_free_bytes": 7 * 1024**3},
        )
        for change in cases:
            with self.subTest(change=change):
                resources = self.good_resources()
                resources.update(change)
                with self.assertRaises(setup.SetupError):
                    setup.check_resources(resources)

    def test_inspect_resources_uses_cgroup_quota_and_headroom(self):
        result = setup.inspect_resources(
            system="Linux",
            machine="x86_64",
            cpu_quota_text="800000 100000",
            memory_limit_text=str(16 * 1024**3),
            memory_current_text=str(6 * 1024**3),
            disk_free_bytes=20 * 1024**3,
        )
        self.assertEqual(result["cpu_threads"], 8)
        self.assertEqual(result["memory_available_bytes"], 10 * 1024**3)


class HelperLifecycleTests(unittest.TestCase):
    def test_helper_timeout_is_bounded_and_reported_without_process_details(self):
        with patch.object(
            setup.subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired(["bash", "start"], timeout=660),
        ) as run:
            with self.assertRaisesRegex(setup.SetupError, "bounded startup deadline"):
                setup._run_helper("start")
        self.assertEqual(run.call_args.kwargs["timeout"], 660)


class DownloadIntegrityTests(unittest.TestCase):
    def test_download_is_https_only_and_atomically_verifies_digest(self):
        payload = b"approved fixture"
        digest = hashlib.sha256(payload).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            destination = pathlib.Path(directory) / "model.gguf"

            def fake_curl(command, **_kwargs):
                output = pathlib.Path(command[command.index("--output") + 1])
                output.write_bytes(payload)
                return subprocess.CompletedProcess(command, 0)

            with patch.object(setup.subprocess, "run", side_effect=fake_curl) as run:
                setup._download_verified("https://example.invalid/pinned", destination, digest, len(payload))

            command = run.call_args.args[0]
            self.assertIn("=https", command)
            self.assertEqual(command[command.index("--proto-redir") + 1], "=https")
            self.assertEqual(destination.read_bytes(), payload)
            self.assertFalse(destination.with_name(destination.name + ".part").exists())

    def test_partial_and_wrong_digest_downloads_are_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = pathlib.Path(directory) / "model.gguf"
            temporary = destination.with_name(destination.name + ".part")

            def interrupted(command, **_kwargs):
                pathlib.Path(command[command.index("--output") + 1]).write_bytes(b"partial")
                raise subprocess.CalledProcessError(18, command)

            with patch.object(setup.subprocess, "run", side_effect=interrupted):
                with self.assertRaises(setup.SetupError):
                    setup._download_verified(
                        "https://example.invalid/pinned",
                        destination,
                        hashlib.sha256(b"approved").hexdigest(),
                        len(b"approved"),
                    )
            self.assertFalse(temporary.exists())
            self.assertFalse(destination.exists())

            def wrong_digest(command, **_kwargs):
                pathlib.Path(command[command.index("--output") + 1]).write_bytes(b"wrong")
                return subprocess.CompletedProcess(command, 0)

            with patch.object(setup.subprocess, "run", side_effect=wrong_digest):
                with self.assertRaises(setup.SetupError):
                    setup._download_verified(
                        "https://example.invalid/pinned",
                        destination,
                        hashlib.sha256(b"approved").hexdigest(),
                        len(b"approved"),
                    )
            self.assertFalse(temporary.exists())
            self.assertFalse(destination.exists())

    def test_managed_serve_fast_path_defers_existing_file_hash_to_proxy(self):
        payload = b"approved fixture"
        with tempfile.TemporaryDirectory() as directory:
            cache = pathlib.Path(directory) / ".local" / "share" / "local-ai-eval"
            model_dir = cache / "models" / "qwen3.5-9b-q3_k_m"
            model_dir.mkdir(parents=True)
            (model_dir / "model.gguf").write_bytes(payload)
            with (
                patch.object(setup, "EVAL_HOME", cache),
                patch.object(setup, "MODEL_DIR", model_dir),
                patch.object(
                    setup,
                    "MODEL_FILES",
                    (("model.gguf", hashlib.sha256(payload).hexdigest(), len(payload)),),
                ),
                patch.object(setup, "sha256_file", side_effect=AssertionError("duplicate hash")),
            ):
                setup._ensure_model_files(verify_existing_digest=False)
            self.assertEqual((model_dir / "model.gguf").read_bytes(), payload)


class RuntimeArchiveLayoutTests(unittest.TestCase):
    def test_accepts_ollama_runtime_nested_under_archive_root(self):
        with tempfile.TemporaryDirectory() as directory:
            extracted = pathlib.Path(directory)
            runtime = extracted / "ollama"
            (runtime / "bin").mkdir(parents=True)
            (runtime / "lib" / "ollama").mkdir(parents=True)
            (runtime / "bin" / "ollama").write_bytes(b"ollama")
            (runtime / "lib" / "ollama" / "llama-server").write_bytes(b"llama")

            self.assertEqual(setup._runtime_archive_candidate(extracted), runtime)

    def test_accepts_official_install_layout_at_archive_root(self):
        with tempfile.TemporaryDirectory() as directory:
            extracted = pathlib.Path(directory)
            (extracted / "bin").mkdir()
            (extracted / "lib" / "ollama").mkdir(parents=True)
            (extracted / "bin" / "ollama").write_bytes(b"ollama")
            (extracted / "lib" / "ollama" / "llama-server").write_bytes(b"llama")

            self.assertEqual(setup._runtime_archive_candidate(extracted), extracted)

    def test_rejects_archive_missing_pinned_runtime_files(self):
        with tempfile.TemporaryDirectory() as directory:
            extracted = pathlib.Path(directory)
            (extracted / "bin").mkdir()
            (extracted / "bin" / "ollama").write_bytes(b"ollama")

            with self.assertRaisesRegex(setup.SetupError, "unexpected layout"):
                setup._runtime_archive_candidate(extracted)


class SafeRemovalTests(unittest.TestCase):
    def test_marker_claims_only_verified_evaluator_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            cache = root / ".local" / "share" / "local-ai-eval"
            model_dir = cache / "models" / "qwen3.5-9b-q3_k_m"
            runtime_dir = cache / "runtime" / "ollama-0.40.5"
            marker = cache / "OWNED_BY_LOCAL_AI_EVAL"
            model_dir.mkdir(parents=True)
            runtime_dir.mkdir(parents=True)
            for name, _digest, _size in setup.MODEL_FILES:
                (model_dir / name).write_bytes(b"verified model fixture")
            (runtime_dir / "llama-server").write_bytes(b"verified runtime fixture")
            (runtime_dir / "internal-runtime-link").symlink_to("llama-server")
            with (
                patch.object(setup, "WORKSPACE_ROOT", root),
                patch.object(setup, "EVAL_HOME", cache),
                patch.object(setup, "MODEL_DIR", model_dir),
                patch.object(setup, "RUNTIME_DIR", runtime_dir),
                patch.object(setup, "MARKER", marker),
                patch.object(setup, "_valid_model_files", return_value=True),
            ):
                setup._write_ownership_marker()
            self.assertEqual(
                json.loads(marker.read_text()),
                setup._expected_ownership_marker(),
            )

    def test_marker_rejects_symlink_that_escapes_runtime_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            cache = root / ".local" / "share" / "local-ai-eval"
            model_dir = cache / "models" / "qwen3.5-9b-q3_k_m"
            runtime_dir = cache / "runtime" / "ollama-0.40.5"
            marker = cache / "OWNED_BY_LOCAL_AI_EVAL"
            model_dir.mkdir(parents=True)
            runtime_dir.mkdir(parents=True)
            for name, _digest, _size in setup.MODEL_FILES:
                (model_dir / name).write_bytes(b"verified model fixture")
            (runtime_dir / "llama-server").write_bytes(b"verified runtime fixture")
            outside = root / "outside"
            outside.write_bytes(b"not owned")
            (runtime_dir / "escape").symlink_to(outside)
            with (
                patch.object(setup, "WORKSPACE_ROOT", root),
                patch.object(setup, "EVAL_HOME", cache),
                patch.object(setup, "MODEL_DIR", model_dir),
                patch.object(setup, "RUNTIME_DIR", runtime_dir),
                patch.object(setup, "MARKER", marker),
            ):
                with self.assertRaisesRegex(setup.SetupError, "outside"):
                    setup._write_ownership_marker()
            self.assertEqual(outside.read_bytes(), b"not owned")

    def test_remove_refuses_unmarked_cache_and_preserves_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            cache = root / ".local" / "share" / "local-ai-eval"
            cache.mkdir(parents=True)
            payload = cache / "model.gguf"
            payload.write_bytes(b"owned model")
            with (
                patch.object(setup, "WORKSPACE_ROOT", root),
                patch.object(setup, "EVAL_HOME", cache),
                patch.object(setup, "MARKER", cache / "OWNED_BY_LOCAL_AI_EVAL"),
                patch.object(setup, "_run_helper"),
                patch("local_model_eval_setup.socket.socket", FakeClosedSocket),
            ):
                with self.assertRaises(setup.SetupError):
                    setup._remove_owned_cache()
            self.assertTrue(payload.exists())

    def test_remove_deletes_only_marked_cache_when_ports_are_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            cache = root / ".local" / "share" / "local-ai-eval"
            cache.mkdir(parents=True)
            model_dir = cache / "models" / "qwen3.5-9b-q3_k_m"
            model_dir.mkdir(parents=True)
            (model_dir / "model.gguf").write_bytes(b"owned model")
            runtime_dir = cache / "runtime" / "ollama-0.40.5"
            runtime_dir.mkdir(parents=True)
            (runtime_dir / "runtime").write_bytes(b"owned runtime")
            legacy_cache = cache / "models" / "blobs" / "legacy.gguf"
            legacy_cache.parent.mkdir(parents=True)
            legacy_cache.write_bytes(b"unrelated cache")
            marker = cache / "OWNED_BY_LOCAL_AI_EVAL"
            marker.write_text(
                json.dumps(setup._expected_ownership_marker()),
                encoding="utf-8",
            )
            with (
                patch.object(setup, "WORKSPACE_ROOT", root),
                patch.object(setup, "EVAL_HOME", cache),
                patch.object(setup, "MARKER", marker),
                patch.object(setup, "_run_helper"),
                patch("local_model_eval_setup.socket.socket", FakeClosedSocket),
            ):
                setup._remove_owned_cache()
            self.assertFalse(model_dir.exists())
            self.assertFalse(runtime_dir.exists())
            self.assertFalse(marker.exists())
            self.assertEqual(legacy_cache.read_bytes(), b"unrelated cache")


class FakeClosedSocket:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def settimeout(self, _timeout):
        return None

    def connect_ex(self, _address):
        return 111


if __name__ == "__main__":
    unittest.main()
