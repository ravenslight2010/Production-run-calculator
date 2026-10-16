import json
import io
import struct
import unittest
from unittest.mock import patch

import local_model_eval_smoke as smoke


class SyntheticDocumentFixtureTests(unittest.TestCase):
    def test_png_is_a_bounded_synthetic_grayscale_document_fixture(self):
        image = smoke._png_synthetic_spec()
        self.assertTrue(image.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertEqual(struct.unpack(">II", image[16:24]), (900, 390))
        self.assertLess(len(image), 64 * 1024)


class SmokeReportTests(unittest.TestCase):
    def setUp(self):
        self.text_success = {
            "state": "completed",
            "matchesExpected": True,
            "latencyMs": 40,
            "outputCharacters": 2,
            "completionTokens": 2,
        }
        self.image_success = {
            "state": "completed",
            "matchesExpected": True,
            "expectedNamesMatch": True,
            "expectedNumbersMatch": True,
            "latencyMs": 80,
            "outputCharacters": 42,
        }

    def test_only_synthetic_metadata_is_reported(self):
        responses = [
            self.text_success,
            self.text_success,
            self.image_success,
        ]
        with (
            patch.object(smoke, "_health", return_value=200),
            patch.object(smoke, "_request", side_effect=responses),
            patch.object(smoke, "MemorySampler", FakeMemorySampler),
        ):
            report = smoke.run_smoke()
        serialized = json.dumps(report)
        self.assertEqual(report["state"], "passed")
        self.assertTrue(report["representativeImage"]["matchesExpected"])
        self.assertTrue(report["syntheticOnly"])
        self.assertFalse(report["retainedRawPrompts"])
        self.assertFalse(report["retainedRawResponses"])
        self.assertNotIn("Reply with only OK", serialized)
        self.assertNotIn("MOZZARELLA", serialized)
        self.assertNotIn("1.25", serialized)

    def test_incorrect_numeric_or_image_result_fails_the_smoke(self):
        invalid_image = {
            **self.image_success,
            "matchesExpected": False,
            "expectedNumbersMatch": False,
        }
        with (
            patch.object(smoke, "_health", return_value=200),
            patch.object(smoke, "_request", side_effect=[
                self.text_success,
                self.text_success,
                invalid_image,
            ]),
            patch.object(smoke, "MemorySampler", FakeMemorySampler),
        ):
            report = smoke.run_smoke()
        self.assertEqual(report["state"], "failed")
        self.assertFalse(report["representativeImage"]["matchesExpected"])

    def test_unavailable_local_service_fails_without_retaining_input(self):
        with patch.object(smoke, "_health", return_value=None):
            report = smoke.run_smoke()
        self.assertEqual(report["state"], "unavailable")
        self.assertFalse(report["retainedRawPrompts"])
        self.assertNotIn("Reply with only OK", json.dumps(report))


class FakeMemorySampler:
    baseline = 100
    peak = 150

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None


class SmokeSemanticScoringTests(unittest.TestCase):
    def _score(self, content):
        response = io.BytesIO(
            json.dumps(
                {
                    "choices": [
                        {
                            "message": {"content": content},
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {"completion_tokens": 12, "prompt_tokens": 30},
                }
            ).encode()
        )
        with patch.object(smoke.HTTP, "open", return_value=response):
            return smoke._request(
                [{"role": "user", "content": "synthetic extraction test"}],
                128,
                ["MOZZARELLA", "PEPPERONI", "TOMATO"],
                ["1.25", "0.50", "0.75"],
            )

    def test_exact_synthetic_names_and_decimal_values_pass(self):
        report = self._score("MOZZARELLA 1.25\nPEPPERONI 0.50\nTOMATO 0.75")
        self.assertTrue(report["expectedNamesMatch"])
        self.assertTrue(report["expectedNumbersMatch"])
        self.assertTrue(report["matchesExpected"])

    def test_wrong_order_or_decimal_value_fails_semantic_match(self):
        wrong_order = self._score("TOMATO 0.75\nPEPPERONI 0.50\nMOZZARELLA 1.25")
        wrong_decimal = self._score("MOZZARELLA 1.25\nPEPPERONI 0.55\nTOMATO 0.75")
        self.assertFalse(wrong_order["expectedNamesMatch"])
        self.assertFalse(wrong_order["matchesExpected"])
        self.assertFalse(wrong_decimal["expectedNumbersMatch"])
        self.assertFalse(wrong_decimal["matchesExpected"])


if __name__ == "__main__":
    unittest.main()
