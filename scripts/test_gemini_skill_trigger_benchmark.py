import hashlib
import json
import os
import subprocess
import sys
import unittest
from unittest.mock import patch
from pathlib import Path
from tempfile import TemporaryDirectory

from gemini_skill_trigger_benchmark import (
    Classification,
    check_checked_in_artifacts,
    FAILURE_CATEGORIES,
    GeminiAdapter,
    evaluate,
    evaluation_manifest,
    metrics,
    private_artifact_fields,
    list_review_cases,
    provider_failure_cases,
    record_manual_decision,
    review_queue,
    select_skill_corpus,
    validate_classification,
    write_benchmark_artifacts,
    write_report,
)
from skill_trigger_benchmark import (
    FOCUSED_LEXICAL_REVIEWS,
    MANAGED_FIXTURE_SKILLS,
    PROMPTS,
    build,
    frontmatter,
    preflight,
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
    def test_folded_skill_descriptions_are_fully_parsed(self):
        root = Path(__file__).resolve().parents[1]
        _, description = frontmatter(root / ".agents" / "skills" / "sync-invariant-check" / "SKILL.md")
        self.assertIn("routes/sync.ts", description)
        self.assertIn("stale writes", description)
        self.assertNotEqual(description, ">")

    def test_focused_lexical_reviews_resolve_all_current_flags(self):
        payload = build()
        self.assertEqual(
            {review["skill"] for review in FOCUSED_LEXICAL_REVIEWS},
            {
                "customer-import-audit",
                "db-schema-change",
                "error-handling",
                "production-go",
                "sync-invariant-check",
                "ad-creative",
                "deep-research",
                "design-thinker",
                "recipe-creator",
            },
        )
        self.assertEqual(
            [row["name"] for row in preflight(payload) if row["status"] == "review"],
            [],
        )

    def test_generator_rejects_prompts_for_unavailable_skills(self):
        with patch.dict(PROMPTS, {
            "missing-skill": (["trigger"], ["near miss"]),
        }):

            with self.assertRaisesRegex(
                SystemExit,
                "Benchmark prompts reference unavailable skills",

            ):
                build()

    def test_generator_covers_benchmarked_skill_inventory_with_canonical_identities(self):
        root = Path(__file__).resolve().parents[1]
        with TemporaryDirectory() as directory:
            generated = Path(directory) / "benchmark.json"
            report = Path(directory) / "benchmark.md"
            result = subprocess.run(
                [
                    sys.executable,
                    str(root / "scripts" / "skill_trigger_benchmark.py"),
                    "--write", str(generated),
                    "--report", str(report),
                ],
                cwd=root,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(generated.read_text())
            project_owned = {
                path.parent.name
                for skill_root in (root / ".agents" / "skills",)
                for path in skill_root.glob("*/SKILL.md")
            }
            expected = project_owned | set(MANAGED_FIXTURE_SKILLS)
            actual = {skill["name"] for skill in payload["skills"]}
            self.assertEqual(actual, expected)
            self.assertEqual(payload["catalog_validation"]["status"], "pass")
            self.assertEqual(
                payload["catalog_validation"]["available_roots"],
                [".agents/skills", ".local/secondary_skills"],
            )
            self.assertEqual(
                payload["catalog_validation"]["intentional_fixture_skills"],
                sorted(MANAGED_FIXTURE_SKILLS),
            )
            self.assertEqual(
                payload["catalog_validation"]["coverage"]["project_owned"],
                sorted(project_owned),
            )
            self.assertEqual(
                payload["catalog_validation"]["coverage"]["managed_curated"],
                sorted(MANAGED_FIXTURE_SKILLS),
            )
            self.assertEqual(
                {
                    skill["name"]
                    for skill in payload["skills"]
                    if skill["ownership"] == "managed"
                },
                set(MANAGED_FIXTURE_SKILLS),
            )
            self.assertEqual(
                {
                    skill["name"]
                    for skill in payload["skills"]
                    if skill["coverage"] == "project-owned"
                },
                project_owned,
            )
            self.assertEqual(
                payload["historical_runtime_attempt"]["status"],
                "blocked_before_model_evaluation",
            )
            self.assertEqual(
                payload["historical_runtime_attempt"]["prompt_count"],
                124,
            )
            self.assertIn(
                "has no model evaluation",
                payload["runtime_status"],
            )
            self.assertTrue(all(skill["metadata_name"] == skill["name"] for skill in payload["skills"]))
            self.assertTrue(all(
                skill["name"] == skill["name"].lower()
                and "_" not in skill["name"]
                and " " not in skill["name"]
                for skill in payload["skills"]
            ))
            self.assertIn(f"Skills: **{len(expected)}**", report.read_text())
            self.assertIn("Catalog validation: **PASS**", report.read_text())

    def test_writing_plans_has_approved_plan_triggers_and_adjacent_near_misses(self):
        payload = build()
        project_skills = payload["catalog_validation"]["coverage"]["project_owned"]
        self.assertIn("writing-plans", project_skills)

        skill = next(
            item for item in payload["skills"] if item["name"] == "writing-plans"
        )
        self.assertEqual(
            [item["should_trigger"] for item in skill["evals"]],
            [True, True, False, False],
        )
        positive, negative = PROMPTS["writing-plans"]
        self.assertEqual(len(positive), 2)
        self.assertEqual(len(negative), 2)
        self.assertTrue(
            all(
                "approved" in query.lower()
                and "multi-step plan" in query.lower()
                for query in positive
            )
        )
        self.assertTrue(
            any(
                "brainstorm" in query.lower()
                and "before we select" in query.lower()
                for query in negative
            )
        )
        self.assertTrue(
            any(
                "one-file bug fix" in query.lower()
                and "does not need a multi-step" in query.lower()
                for query in negative
            )
        )
        checked_in = json.loads(
            (Path(__file__).resolve().parents[1] / "skill-trigger-benchmark.json").read_text()
        )
        checked_in_skill = next(
            item for item in checked_in["skills"] if item["name"] == "writing-plans"
        )
        self.assertEqual(
            [item["should_trigger"] for item in checked_in_skill["evals"]],
            [True, True, False, False],
        )

    def test_checked_in_benchmark_only_references_available_skills(self):
        root = Path(__file__).resolve().parents[1]
        available = {

            path.parent.name

            for skill_root in (
                root / ".agents" / "skills",
                root / ".local" / "secondary_skills",
            )
            for path in skill_root.glob("*/SKILL.md")
        }
        payload = json.loads((root / "skill-trigger-benchmark.json").read_text())
        benchmarked = {skill["name"] for skill in payload["skills"]}
        self.assertEqual(benchmarked - available, set())
        generated_inventory = {skill["name"] for skill in build()["skills"]}
        self.assertEqual(benchmarked, generated_inventory)
        queue = json.loads((root / "gemini-skill-trigger-review-queue.json").read_text())
        queued = {case["skill"] for case in queue["cases"]}
        self.assertEqual(queued - benchmarked, set())

    def test_checked_in_benchmark_preserves_provider_boundaries(self):
        root = Path(__file__).resolve().parents[1]
        corpus_payload = json.loads((root / "skill-trigger-benchmark.json").read_text())
        runtime_metrics = corpus_payload["runtime_metrics"]
        self.assertTrue(runtime_metrics)
        self.assertTrue(all(metric["precision"] is None for metric in runtime_metrics))
        self.assertTrue(all("unavailable" in metric["status"] for metric in runtime_metrics))
        self.assertIn(
            "has no model evaluation",
            corpus_payload["runtime_status"],
        )

        report = (root / "skill-trigger-benchmark.md").read_text()
        self.assertIn("not model observations", report)
        self.assertIn("not claims that Claude would trigger", report)
        queue = json.loads((root / "gemini-skill-trigger-review-queue.json").read_text())
        self.assertTrue(queue["manual_decisions_excluded_from_metrics"])

    def test_checked_in_artifacts_are_sanitized_historical_evidence(self):
        root = Path(__file__).resolve().parents[1]
        check_checked_in_artifacts(root)
        for name in (
            "gemini-skill-trigger-benchmark.json",
            "gemini-skill-trigger-review-queue.json",
        ):
            payload = json.loads((root / name).read_text())
            self.assertEqual(payload["execution_mode"], "sanitized_historical_artifact")
            self.assertFalse(payload["ci_evidence"])
            self.assertFalse(payload["provenance"]["fresh_provider_run"])
            self.assertEqual(payload["privacy"]["retainedEvaluationContent"], "none")

    def test_private_artifact_field_check_is_recursive_and_deterministic(self):
        payload = {
            "results": [{"rationale": "private", "nested": {"query": "private"}}],
            "provider_payload": {"body": "private"},
        }
        self.assertEqual(
            private_artifact_fields(payload),
            [
                "$.provider_payload",
                "$.results[0].nested.query",
                "$.results[0].rationale",
            ],
        )

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
        self.assertEqual([case["id"] for case in provider_failure_cases(result)], ["yes", "no"])

    def test_invalid_output_is_reviewed(self):
        adapter = Fixture([{"decision": "maybe", "confidence": 0.9, "rationale": "x"}] * 2)
        result = evaluate(corpus(), adapter, retries=0)
        self.assertEqual(result[0]["status"], "invalid_output")
        self.assertEqual(result[0]["failure_category"], "field_validation")
        self.assertEqual(review_queue(result)[0]["reason"], "invalid_output")
        self.assertEqual(
            review_queue(result)[0]["failure_category"], "field_validation"
        )

    def test_invalid_gemini_output_categories_are_safe_and_excluded(self):
        def provider_reply(text):
            return json.dumps({
                "candidates": [{"content": {"parts": [{"text": text}]}}],
            }).encode()

        raw_replies = iter([
            b"NOT_JSON PROVIDER_PAYLOAD_SENTINEL",
            provider_reply("NOT_JSON CLASSIFICATION_RESPONSE_SENTINEL"),
            json.dumps({"candidates": []}).encode(),
            provider_reply(json.dumps({
                "decision": "maybe",
                "confidence": 0.9,
                "rationale": "RATIONALE_SENTINEL",
            })),
        ])
        adapter = GeminiAdapter(
            api_key="CREDENTIAL_SENTINEL",
            base_url="https://offline.test",
            transport=lambda _url, _key, _body: next(raw_replies),
        )
        test_corpus = {
            "skills": [{
                "name": "demo",
                "description": "offline fixture",
                "evals": [
                    {
                        "id": "outer-json",
                        "query": "PROMPT_SENTINEL outer JSON",
                        "should_trigger": True,
                    },
                    {
                        "id": "classification-json",
                        "query": "PROMPT_SENTINEL classification JSON",
                        "should_trigger": True,
                    },
                    {
                        "id": "response-shape",
                        "query": "PROMPT_SENTINEL response shape",
                        "should_trigger": True,
                    },
                    {
                        "id": "invalid-field",
                        "query": "PROMPT_SENTINEL invalid field",
                        "should_trigger": True,
                    },
                ],
            }],
        }
        records = evaluate(test_corpus, adapter, retries=0)
        categories = [
            "json_parsing",
            "json_parsing",
            "response_schema",
            "field_validation",
        ]

        self.assertEqual([row["status"] for row in records], ["invalid_output"] * 4)
        self.assertEqual(
            [row["failure_category"] for row in records],
            categories,
        )
        self.assertTrue(set(categories).issubset(FAILURE_CATEGORIES))
        measured = metrics(records)
        self.assertEqual(measured["evaluated"], 0)
        self.assertEqual(measured["excluded"], 4)
        self.assertIsNone(measured["accuracy"])

        source_bytes = json.dumps(test_corpus).encode()
        manifest = evaluation_manifest(
            source_bytes,
            test_corpus,
            records,
            "offline-fixture",
            0.75,
            0,
        )
        self.assertEqual(manifest["outcome"]["state"], "failed")
        self.assertEqual(manifest["provenance"]["evidence"]["state"], "hashed")

        with TemporaryDirectory() as directory:
            root = Path(directory)
            result_paths = [
                root / "results.json",
                root / "queue.json",
                root / "report.md",
            ]
            write_benchmark_artifacts(
                *result_paths,
                {
                    "provider": "gemini",
                    "model": "offline-fixture",
                    "run_at": "2026-10-07T00:00:00+00:00",
                    "metrics": measured,
                    "evaluationManifest": manifest,
                },
                records,
            )
            artifact_text = "\n".join(path.read_text() for path in result_paths)
            for sentinel in (
                "PROVIDER_PAYLOAD_SENTINEL",
                "CLASSIFICATION_RESPONSE_SENTINEL",
                "RATIONALE_SENTINEL",
                "CREDENTIAL_SENTINEL",
                "PROMPT_SENTINEL",
            ):
                self.assertNotIn(sentinel, artifact_text)

            result_payload = json.loads(result_paths[0].read_text())
            self.assertEqual(
                [row["failure_category"] for row in result_payload["results"]],
                categories,
            )
            self.assertTrue(
                all("query" not in row and "rationale" not in row
                    for row in result_payload["results"])
            )
            queue_payload = json.loads(result_paths[1].read_text())
            self.assertEqual(
                [case["failure_category"] for case in queue_payload["cases"]],
                categories,
            )

    def test_unrecognized_failure_categories_are_not_retained(self):
        record = {
            "id": "invalid",
            "skill": "demo",
            "expected": "trigger",
            "attempts": 1,
            "status": "invalid_output",
            "error": "invalid_output",
            "failure_category": "UNTRUSTED_CATEGORY_SENTINEL",
        }
        with TemporaryDirectory() as directory:
            root = Path(directory)
            result_paths = [
                root / "results.json",
                root / "queue.json",
                root / "report.md",
            ]
            write_benchmark_artifacts(
                *result_paths,
                {
                    "provider": "gemini",
                    "model": "offline-fixture",
                    "run_at": "2026-10-07T00:00:00+00:00",
                    "metrics": metrics([record]),
                },
                [record],
            )
            artifact_text = "\n".join(path.read_text() for path in result_paths)
            self.assertNotIn("UNTRUSTED_CATEGORY_SENTINEL", artifact_text)
            retained = json.loads(result_paths[0].read_text())["results"][0]
            queued = json.loads(result_paths[1].read_text())["cases"][0]
            self.assertNotIn("failure_category", retained)
            self.assertNotIn("failure_category", queued)

    def test_provider_failure_remains_distinct_from_invalid_output(self):
        adapter = Fixture([RuntimeError("provider connection failed")] * 2)
        result = evaluate(corpus(), adapter, retries=0)
        self.assertEqual([row["status"] for row in result], ["provider_failure", "provider_failure"])
        self.assertTrue(all(row["error"] == "provider_failure" for row in result))

    def test_deterministic_success_uses_only_the_injected_adapter(self):
        adapter = Fixture([
            {"decision": "trigger", "confidence": 1, "rationale": "fixture"},
            {"decision": "do_not_trigger", "confidence": 1, "rationale": "fixture"},
        ])
        with patch.object(GeminiAdapter, "classify", side_effect=AssertionError("live adapter used")):
            result = evaluate(corpus(), adapter, retries=0)
        self.assertEqual([row["status"] for row in result], ["included", "included"])
        self.assertEqual(adapter.calls, 2)

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

    def test_skill_selection_evaluates_only_requested_cases_and_hashes_both_corpora(self):
        source = {
            "skills": [
                {"name": "first", "description": "first skill", "evals": [
                    {"id": "first-yes", "query": "first", "should_trigger": True},
                ]},
                {"name": "second", "description": "second skill", "evals": [
                    {"id": "second-yes", "query": "second yes", "should_trigger": True},
                    {"id": "second-no", "query": "second no", "should_trigger": False},
                ]},
            ],
        }
        source_bytes = json.dumps(source).encode()
        selected = select_skill_corpus(source, ["second"])
        adapter = Fixture([
            {"decision": "trigger", "confidence": 1, "rationale": "fixture"},
            {"decision": "do_not_trigger", "confidence": 1, "rationale": "fixture"},
        ])
        records = evaluate(selected, adapter, retries=0)
        selected_bytes = json.dumps(
            selected,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        manifest = evaluation_manifest(
            source_bytes,
            selected,
            records,
            "fixture-model",
            0.75,
            0,
            selected_bytes,
            sum(len(skill["evals"]) for skill in source["skills"]),
        )

        self.assertEqual([row["id"] for row in records], ["second-yes", "second-no"])
        self.assertEqual(adapter.calls, 2)
        self.assertEqual(manifest["corpus"]["sha256"], hashlib.sha256(source_bytes).hexdigest())
        self.assertEqual(manifest["corpus"]["cases"], 3)
        self.assertEqual(manifest["outcome"]["state"], "passed")
        self.assertEqual(manifest["selection"]["skills"], ["second"])
        self.assertEqual(manifest["selection"]["cases"], 2)
        with TemporaryDirectory() as directory:
            report_path = Path(directory) / "focused-report.md"
            write_report(report_path, {
                "provider": "gemini",
                "model": "fixture-model",
                "run_at": "2026-10-07T00:00:00+00:00",
                "metrics": metrics(records),
                "evaluationManifest": manifest,
            })
            report = report_path.read_text()
        self.assertIn(
            f"Source corpus: SHA-256 `{manifest['corpus']['sha256']}`; **3 cases**",
            report,
        )
        self.assertIn("- Selected skills: **second**; **2 cases**", report)
        self.assertEqual(
            manifest["selection"]["sha256"],
            hashlib.sha256(selected_bytes).hexdigest(),
        )
        self.assertEqual(
            manifest["provenance"]["sourceSha256"],
            manifest["corpus"]["sha256"],
        )
        self.assertEqual(
            manifest["provenance"]["selectedCorpusSha256"],
            manifest["selection"]["sha256"],
        )

    def test_unfiltered_report_identifies_all_source_skills(self):
        source = {
            "skills": [
                {"name": "first", "description": "first skill", "evals": [
                    {"id": "first-yes", "query": "first", "should_trigger": True},
                ]},
                {"name": "second", "description": "second skill", "evals": [
                    {"id": "second-no", "query": "second", "should_trigger": False},
                ]},
            ],
        }
        source_bytes = json.dumps(source).encode()
        records = evaluate(source, Fixture([
            {"decision": "trigger", "confidence": 1, "rationale": "fixture"},
            {"decision": "do_not_trigger", "confidence": 1, "rationale": "fixture"},
        ]), retries=0)
        manifest = evaluation_manifest(
            source_bytes,
            source,
            records,
            "fixture-model",
            0.75,
            0,
        )

        with TemporaryDirectory() as directory:
            report_path = Path(directory) / "full-report.md"
            write_report(report_path, {
                "provider": "gemini",
                "model": "fixture-model",
                "run_at": "2026-10-07T00:00:00+00:00",
                "metrics": metrics(records),
                "evaluationManifest": manifest,
            })
            report = report_path.read_text()

        self.assertIn(
            f"Source corpus: SHA-256 `{manifest['corpus']['sha256']}`; **2 cases**",
            report,
        )
        self.assertIn("- Selected skills: **all source skills**; **2 cases**", report)

    def test_skill_selection_rejects_unknown_names(self):
        with self.assertRaisesRegex(ValueError, "unknown skill name\\(s\\): missing"):
            select_skill_corpus(corpus(), ["missing"])

    def test_manifest_distinguishes_unavailable_and_failed_without_payloads(self):
        with patch.dict("os.environ", {
            "AI_INTEGRATIONS_GEMINI_API_KEY": "",
            "AI_INTEGRATIONS_GEMINI_BASE_URL": "",
        }, clear=False):
            unavailable_records = evaluate(
                corpus(),
                GeminiAdapter(api_key="", base_url=""),
                retries=0,
            )
        manifest = evaluation_manifest(
            json.dumps(corpus()).encode(),
            corpus(),
            unavailable_records,
            "fixture-model",
            0.75,
            0,
        )
        self.assertEqual(manifest["outcome"]["state"], "unavailable")
        self.assertEqual(
            manifest["selection"]["sha256"],
            hashlib.sha256(json.dumps(corpus()).encode()).hexdigest(),
        )
        self.assertEqual(manifest["selection"]["cases"], 2)
        self.assertEqual(manifest["execution"]["retries"], 0)
        self.assertFalse(manifest["privacy"]["rawProviderPayloadsRetained"])
        self.assertEqual(manifest["privacy"]["mode"], "metadata-only")
        self.assertEqual(manifest["privacy"]["retainedEvaluationContent"], "none")
        self.assertNotIn("results", manifest)
        failed = [{**unavailable_records[0], "status": "provider_failure"}]
        self.assertEqual(
            evaluation_manifest(
                b"{}",
                {"skills": []},
                failed,
                "fixture-model",
                0.75,
                2,
            )["outcome"]["state"],
            "failed",
        )
        retried = [{
            "status": "included",
            "expected": "trigger",
            "decision": "trigger",
            "attempts": 2,
        }]
        retried_manifest = evaluation_manifest(
            b"{}",
            {"skills": [{"name": "demo", "evals": [{}]}]},
            retried,
            "fixture-model",
            0.75,
            2,
        )
        self.assertEqual(retried_manifest["execution"]["retries"], 1)

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

    def test_all_benchmark_artifacts_exclude_private_model_content(self):
        private_values = {
            "RAW_PROMPT_SENTINEL",
            "PROVIDER_PAYLOAD_SENTINEL",
            "CREDENTIAL_SENTINEL",
            "CONVERSATION_TEXT_SENTINEL",
        }
        records = [{
            "id": "synthetic-private-case",
            "skill": "synthetic-skill",
            "query": "RAW_PROMPT_SENTINEL CONVERSATION_TEXT_SENTINEL",
            "expected": "trigger",
            "attempts": 1,
            "decision": "do_not_trigger",
            "confidence": 0.91,
            "rationale": "PROVIDER_PAYLOAD_SENTINEL",
            "provider_payload": {"body": "PROVIDER_PAYLOAD_SENTINEL"},
            "credential": "CREDENTIAL_SENTINEL",
            "conversation": "CONVERSATION_TEXT_SENTINEL",
            "status": "disagreement",
        }]
        result = {
            "provider": "gemini",
            "model": "synthetic-model",
            "run_at": "2026-09-14T00:00:00+00:00",
            "metrics": metrics(records),
            "results": records,
            "evaluationManifest": {
                "privacy": {
                    "mode": "metadata-only",
                    "rawProviderPayloadsRetained": False,
                    "retainedEvaluationContent": "none",
                },
            },
        }
        with TemporaryDirectory() as directory:
            root = Path(directory)
            paths = [
                root / "results.json",
                root / "queue.json",
                root / "report.md",
            ]
            write_benchmark_artifacts(*paths, result, records)

            retained = "\n".join(path.read_text() for path in paths)
            for private_value in private_values:
                self.assertNotIn(private_value, retained)

            results_payload = json.loads(paths[0].read_text())
            self.assertEqual(
                results_payload["results"],
                [{
                    "id": "synthetic-private-case",
                    "skill": "synthetic-skill",
                    "expected": "trigger",
                    "attempts": 1,
                    "decision": "do_not_trigger",
                    "confidence": 0.91,
                    "status": "disagreement",
                }],
            )
            queue_payload = json.loads(paths[1].read_text())
            self.assertEqual(queue_payload["cases"][0]["reason"], "disagreement")
            self.assertNotIn("query", queue_payload["cases"][0])
            self.assertNotIn("rationale", queue_payload["cases"][0]["gemini"])

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
                "--live-provider",
                "--corpus", str(corpus_path),
                "--results", str(root / "results.json"),
                "--report", str(root / "report.md"),
                "--queue", str(root / "benchmark-queue.json"),
                "--decisions", str(decisions),
            )
            self.assertEqual(benchmark.returncode, 0, benchmark.stderr)
            self.assertIn('"evaluated": 0', benchmark.stdout)
            self.assertEqual(decisions.read_bytes(), decisions_before_benchmark)

    def test_benchmark_refuses_live_access_without_explicit_opt_in(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            corpus_path = root / "corpus.json"
            corpus_path.write_text(json.dumps(corpus()))
            script = Path(__file__).with_name("gemini_skill_trigger_benchmark.py").resolve()
            result = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "benchmark",
                    "--corpus", str(corpus_path),
                    "--results", str(root / "results.json"),
                ],
                cwd=root,
                env={
                    **os.environ,
                    "AI_INTEGRATIONS_GEMINI_API_KEY": "must-not-be-used",
                    "AI_INTEGRATIONS_GEMINI_BASE_URL": "https://must-not-be-used.invalid",
                },
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("benchmark is offline by default", result.stderr)
            self.assertFalse((root / "results.json").exists())

    def test_live_provider_mode_writes_artifacts_then_fails_closed(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            corpus_path = root / "corpus.json"
            source = {
                "skills": [
                    {"name": "first", "description": "first skill", "evals": [
                        {"id": "first-yes", "query": "first", "should_trigger": True},
                    ]},
                    {"name": "second", "description": "second skill", "evals": [
                        {"id": "second-yes", "query": "second", "should_trigger": True},
                    ]},
                ],
            }
            source_bytes = json.dumps(source).encode()
            corpus_path.write_bytes(source_bytes)
            script = Path(__file__).with_name("gemini_skill_trigger_benchmark.py").resolve()
            result = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "benchmark",
                    "--live-provider",
                    "--corpus", str(corpus_path),
                    "--results", str(root / "results.json"),
                    "--report", str(root / "report.md"),
                    "--queue", str(root / "queue.json"),
                ],
                cwd=root,
                env={
                    **os.environ,
                    "AI_INTEGRATIONS_GEMINI_API_KEY": "",
                    "AI_INTEGRATIONS_GEMINI_BASE_URL": "",
                },
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 1)
            self.assertIn("Gemini provider health check failed", result.stderr)
            self.assertTrue((root / "results.json").exists())
            self.assertTrue((root / "report.md").exists())
            self.assertTrue((root / "queue.json").exists())
            payload = json.loads((root / "results.json").read_text())
            self.assertEqual(payload["execution_mode"], "live_provider_opt_in")
            self.assertFalse(payload["ci_evidence"])
            self.assertEqual(
                [row["id"] for row in payload["results"]],
                ["first-yes", "second-yes"],
            )
            self.assertEqual(
                payload["evaluationManifest"]["corpus"]["sha256"],
                hashlib.sha256(source_bytes).hexdigest(),
            )
            self.assertEqual(
                payload["evaluationManifest"]["selection"]["sha256"],
                hashlib.sha256(source_bytes).hexdigest(),
            )

    def test_cli_filters_to_repeated_skill_names_and_rejects_unknown_name(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = {
                "skills": [
                    {"name": "first", "description": "first skill", "evals": [
                        {"id": "first-case", "query": "first", "should_trigger": True},
                    ]},
                    {"name": "second", "description": "second skill", "evals": [
                        {"id": "second-case", "query": "second", "should_trigger": True},
                    ]},
                    {"name": "third", "description": "third skill", "evals": [
                        {"id": "third-case", "query": "third", "should_trigger": True},
                    ]},
                ],
            }
            source_bytes = json.dumps(source).encode()
            corpus_path = root / "corpus.json"
            corpus_path.write_bytes(source_bytes)
            script = Path(__file__).with_name("gemini_skill_trigger_benchmark.py").resolve()
            environment = {
                **os.environ,
                "AI_INTEGRATIONS_GEMINI_API_KEY": "",
                "AI_INTEGRATIONS_GEMINI_BASE_URL": "",
            }

            def run_cli(*arguments):
                return subprocess.run(
                    [sys.executable, str(script), "benchmark", "--live-provider",
                     "--corpus", str(corpus_path), *arguments],
                    cwd=root,
                    env=environment,
                    capture_output=True,
                    text=True,
                )

            selected = run_cli(
                "--skill", "third",
                "--skill", "first",
                "--results", str(root / "selected-results.json"),
                "--report", str(root / "selected-report.md"),
                "--queue", str(root / "selected-queue.json"),
            )
            self.assertEqual(selected.returncode, 1, selected.stderr)
            payload = json.loads((root / "selected-results.json").read_text())
            self.assertEqual(
                [row["id"] for row in payload["results"]],
                ["first-case", "third-case"],
            )
            selection = payload["evaluationManifest"]["selection"]
            self.assertEqual(selection["skills"], ["first", "third"])
            self.assertEqual(selection["cases"], 2)
            self.assertEqual(
                payload["evaluationManifest"]["corpus"]["sha256"],
                hashlib.sha256(source_bytes).hexdigest(),
            )
            self.assertNotEqual(selection["sha256"], hashlib.sha256(source_bytes).hexdigest())

            unknown = run_cli(
                "--skill", "missing",
                "--results", str(root / "invalid-results.json"),
            )
            self.assertEqual(unknown.returncode, 2)
            self.assertIn("unknown skill name(s): missing", unknown.stderr)
            self.assertIn("Available skills: first, second, third", unknown.stderr)
            self.assertFalse((root / "invalid-results.json").exists())


if __name__ == "__main__":
    unittest.main()
