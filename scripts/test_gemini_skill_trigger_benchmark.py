import unittest
from unittest.mock import patch

from gemini_skill_trigger_benchmark import (
    Classification,
    GeminiAdapter,
    evaluate,
    metrics,
    review_queue,
    validate_classification,
)


def corpus():
    return {"skills": [{"name": "demo", "description": "demo skill", "evals": [
        {"id": "yes", "query": "do it", "should_trigger": True},
        {"id": "no", "query": "do not", "should_trigger": False},
    ]}]}


class Fixture:
    def __init__(self, values):
        self.values = iter(values)
        self.calls = 0

    def classify(self, skill, item):
        self.calls += 1
        value = next(self.values)
        if isinstance(value, Exception):
            raise value
        return value


class GeminiBenchmarkTests(unittest.TestCase):
    def test_valid_classification_and_validation(self):
        value = validate_classification({"decision": "trigger", "confidence": 0.9, "rationale": "clear"})
        self.assertEqual(value, Classification("trigger", 0.9, "clear"))

    def test_missing_provider_configuration_routes_to_review(self):
        adapter = GeminiAdapter(api_key="", base_url="")
        with patch.dict("os.environ", {
            "AI_INTEGRATIONS_GEMINI_API_KEY": "",
            "AI_INTEGRATIONS_GEMINI_BASE_URL": "",
        }, clear=False):
            result = evaluate(corpus(), adapter, retries=0)
        self.assertTrue(all(r["status"] == "provider_unavailable" for r in result))
        self.assertIsNone(metrics(result)["accuracy"])
        self.assertEqual(len(review_queue(result)), 2)

    def test_invalid_output_is_reviewed(self):
        adapter = Fixture([{"decision": "maybe", "confidence": 0.9, "rationale": "x"}] * 2)
        result = evaluate(corpus(), adapter, retries=0)
        self.assertEqual(result[0]["status"], "invalid_output")
        self.assertEqual(review_queue(result)[0]["reason"], "invalid_output")

    def test_transient_failure_retries(self):
        adapter = Fixture([RuntimeError("transient timeout"), {"decision": "trigger", "confidence": 1, "rationale": "clear"}, {"decision": "do_not_trigger", "confidence": 1, "rationale": "clear"}])
        result = evaluate(corpus(), adapter, retries=1, sleep=lambda _: None)
        self.assertEqual(result[0]["attempts"], 2)
        self.assertEqual(result[0]["status"], "included")

    def test_uncertainty_and_disagreement_queue(self):
        adapter = Fixture([{"decision": "uncertain", "confidence": 0.9, "rationale": "ambiguous"}, {"decision": "trigger", "confidence": 0.9, "rationale": "wrong"}])
        result = evaluate(corpus(), adapter, retries=0)
        self.assertEqual([r["status"] for r in result], ["uncertain", "disagreement"])
        self.assertEqual(len(review_queue(result)), 2)
        self.assertEqual(metrics(result)["evaluated"], 1)

    def test_metric_calculation(self):
        rows = [
            {"expected": "trigger", "decision": "trigger", "status": "included"},
            {"expected": "trigger", "decision": "do_not_trigger", "status": "disagreement"},
            {"expected": "do_not_trigger", "decision": "trigger", "status": "disagreement"},
            {"expected": "do_not_trigger", "decision": "do_not_trigger", "status": "included"},
            {"expected": "trigger", "status": "uncertain"},
        ]
        result = metrics(rows)
        self.assertEqual(result["confusion"], {"true_positive": 1, "false_positive": 1, "true_negative": 1, "false_negative": 1})
        self.assertEqual(result["accuracy"], 0.5)
        self.assertEqual(result["excluded"], 1)


if __name__ == "__main__":
    unittest.main()