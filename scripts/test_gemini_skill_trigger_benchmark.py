import json
import subprocess
import sys
import unittest
from unittest.mock import patch
from pathlib import Path
from tempfile import TemporaryDirectory

from gemini_skill_trigger_benchmark import (
    Classification,
    GeminiAdapter,
    evaluate,
    metrics,
    list_review_cases,
    record_manual_decision,
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

    def test_manual_decisions_are_stored_separately_and_removed_from_pending(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            queue = root / "queue.json"
            decisions = root / "decisions.json"
            queue.write_text(json.dumps({
                "provider": "gemini",
                "cases": [
                    {"id": "one", "skill": "demo", "reason": "disagreement"},
                    {"id": "two", "skill": "demo", "reason": "uncertain"},
                ],
            }))
            record = record_manual_decision(
                queue, decisions, "one", "do_not_trigger", "The request is not in scope."
            )
            self.assertEqual(record["id"], "one")
            self.assertEqual([case["id"] for case in list_review_cases(queue, decisions)], ["two"])
            payload = json.loads(decisions.read_text())
            self.assertTrue(payload["manual_decisions_excluded_from_metrics"])
            self.assertEqual(payload["decisions"][0]["decision"], "do_not_trigger")

    def test_manual_decision_rejects_unknown_or_duplicate_cases(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            queue = root / "queue.json"
            decisions = root / "decisions.json"
            queue.write_text(json.dumps({"cases": [{"id": "one"}]}))
            with self.assertRaises(SystemExit):
                record_manual_decision(queue, decisions, "missing", "trigger", "reason")
            record_manual_decision(queue, decisions, "one", "trigger", "reason")
            with self.assertRaises(SystemExit):
                record_manual_decision(queue, decisions, "one", "trigger", "again")

    def test_cli_review_workflow_and_benchmark_decisions_isolation(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            queue = root / "queue.json"
            decisions = root / "decisions.json"
            queue.write_text(json.dumps({
                "provider": "gemini",
                "cases": [
                    {"id": "one", "skill": "demo", "reason": "disagreement"},
                    {"id": "two", "skill": "demo", "reason": "uncertain"},
                ],
            }))
            script = Path(__file__).with_name("gemini_skill_trigger_benchmark.py").resolve()

            def run_cli(*arguments):
                return subprocess.run(
                    [sys.executable, str(script), *arguments],
                    cwd=root,
                    capture_output=True,
                    text=True,
                )

            listed = run_cli(
                "review", "list",
                "--queue", str(queue),
                "--decisions", str(decisions),
            )
            self.assertEqual(listed.returncode, 0, listed.stderr)
            self.assertIn("2 pending case(s)", listed.stdout)
            self.assertIn("one", listed.stdout)
            self.assertIn("two", listed.stdout)

            decided = run_cli(
                "review", "decide",
                "--queue", str(queue),
                "--decisions", str(decisions),
                "--id", "one",
                "--decision", "do_not_trigger",
                "--reason", "The request is not in scope.",
            )
            self.assertEqual(decided.returncode, 0, decided.stderr)
            self.assertTrue(decisions.exists())
            decision_payload = json.loads(decisions.read_text())
            self.assertEqual(decision_payload["decisions"][0]["id"], "one")
            self.assertEqual(decision_payload["decisions"][0]["decision"], "do_not_trigger")

            listed_after_decision = run_cli(
                "review", "list",
                "--queue", str(queue),
                "--decisions", str(decisions),
            )
            self.assertEqual(listed_after_decision.returncode, 0, listed_after_decision.stderr)
            self.assertIn("1 pending case(s)", listed_after_decision.stdout)
            self.assertNotIn("one", listed_after_decision.stdout)
            self.assertIn("two", listed_after_decision.stdout)

            decisions.write_text("manual decisions must not be read by benchmark\n")
            decisions_before_benchmark = decisions.read_bytes()
            corpus_path = root / "corpus.json"
            corpus_path.write_text(json.dumps({"skills": []}))
            benchmark = run_cli(
                "benchmark",
                "--corpus", str(corpus_path),
                "--results", str(root / "results.json"),
                "--report", str(root / "report.md"),
                "--queue", str(root / "benchmark-queue.json"),
                "--decisions", str(decisions),
            )
            self.assertEqual(benchmark.returncode, 0, benchmark.stderr)
            self.assertIn('"evaluated": 0', benchmark.stdout)
            self.assertEqual(decisions.read_bytes(), decisions_before_benchmark)


if __name__ == "__main__":
    unittest.main()
