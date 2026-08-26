#!/usr/bin/env python3
"""Evaluate the held-out skill trigger corpus with Gemini.

This is deliberately separate from run_eval.py: Gemini classification is not
Claude tool-selection evidence. Provider failures remain failures and are
never converted into do-not-trigger decisions.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable


DECISIONS = {"trigger", "do_not_trigger", "uncertain"}
DEFAULT_MODEL = "gemini-2.5-flash"
DEFAULT_CONFIDENCE = 0.75
MAX_RATIONALE_CHARS = 500
MAX_MANUAL_REASON_CHARS = 1000
DEFAULT_MANUAL_DECISIONS = Path("gemini-skill-trigger-manual-decisions.json")


class ProviderUnavailable(RuntimeError):
    pass


class ProviderFailure(RuntimeError):
    pass


@dataclass(frozen=True)
class Classification:
    decision: str
    confidence: float
    rationale: str


def validate_classification(value: Any) -> Classification:
    if isinstance(value, Classification):
        return value
    if not isinstance(value, dict):
        raise ValueError("response must be a JSON object")
    decision = value.get("decision")
    confidence = value.get("confidence")
    rationale = value.get("rationale")
    if decision not in DECISIONS:
        raise ValueError("decision must be trigger, do_not_trigger, or uncertain")
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        raise ValueError("confidence must be numeric")
    if not 0 <= confidence <= 1:
        raise ValueError("confidence must be between 0 and 1")
    if not isinstance(rationale, str) or not rationale.strip():
        raise ValueError("rationale must be a non-empty string")
    if len(rationale) > MAX_RATIONALE_CHARS:
        raise ValueError("rationale is too long")
    return Classification(decision, float(confidence), rationale.strip())


def _prompt(skill: dict[str, Any], item: dict[str, Any]) -> str:
    return (
        "Classify whether the skill should be used for this user request. "
        "Return JSON only with exactly decision, confidence, and rationale. "
        "decision must be trigger, do_not_trigger, or uncertain. confidence "
        "must be a number from 0 to 1. Use uncertain when the evidence is "
        "ambiguous; do not infer from the expected label.\n\n"
        f"Skill: {skill['name']}\n"
        f"Skill description: {skill['description']}\n"
        f"User request: {item['query']}"
    )


class GeminiAdapter:
    """Small lazy REST adapter for the Replit Gemini AI integration."""

    provider = "gemini"

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        api_key: str | None = None,
        base_url: str | None = None,
        transport: Callable[..., bytes] | None = None,
    ):
        self.model = model
        self._api_key = api_key
        self._base_url = base_url
        self._transport = transport or self._request

    def _config(self) -> tuple[str, str]:
        key = self._api_key or os.getenv("AI_INTEGRATIONS_GEMINI_API_KEY")
        base = self._base_url or os.getenv("AI_INTEGRATIONS_GEMINI_BASE_URL")
        if not key or not base:
            raise ProviderUnavailable(
                "Gemini integration is unavailable: required environment configuration is missing"
            )
        return key, base.rstrip("/")

    def ensure_available(self) -> None:
        self._config()

    def classify(self, skill: dict[str, Any], item: dict[str, Any]) -> Classification:
        key, base = self._config()
        body = {
            "contents": [{"role": "user", "parts": [{"text": _prompt(skill, item)}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "OBJECT",
                    "properties": {
                        "decision": {"type": "STRING", "enum": sorted(DECISIONS)},
                        "confidence": {"type": "NUMBER"},
                        "rationale": {"type": "STRING"},
                    },
                    "required": ["decision", "confidence", "rationale"],
                },
            },
        }
        url = f"{base}/models/{self.model}:generateContent"
        try:
            raw = self._transport(url, key, body)
            payload = json.loads(raw)
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
            return validate_classification(json.loads(text))
        except ProviderUnavailable:
            raise
        except (ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            raise ProviderFailure("Gemini returned invalid structured output") from exc
        except Exception as exc:
            raise ProviderFailure("Gemini request failed") from exc

    @staticmethod
    def _request(url: str, key: str, body: dict[str, Any]) -> bytes:
        request = urllib.request.Request(
            url,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "x-goog-api-key": key},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code in {408, 409, 429} or exc.code >= 500:
                raise ProviderFailure(f"transient Gemini HTTP failure ({exc.code})") from exc
            raise ProviderFailure(f"Gemini HTTP failure ({exc.code})") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise ProviderFailure("transient Gemini network failure") from exc


def _is_transient(error: Exception) -> bool:
    return "transient" in str(error).lower()


def evaluate(
    corpus: dict[str, Any],
    adapter: Any,
    confidence_threshold: float = DEFAULT_CONFIDENCE,
    retries: int = 2,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    for skill in corpus["skills"]:
        for item in skill["evals"]:
            classification = None
            error = None
            attempts = 0
            for attempt in range(retries + 1):
                attempts = attempt + 1
                try:
                    classification = validate_classification(adapter.classify(skill, item))
                    break
                except ProviderUnavailable:
                    error = "provider_unavailable"
                    break
                except ValueError:
                    error = "invalid_output"
                    break
                except Exception as exc:
                    error = "invalid_output" if "structured output" in str(exc).lower() else "provider_failure"
                    if attempt >= retries or not _is_transient(exc):
                        break
                    sleep(0.2 * (2**attempt))
            record: dict[str, Any] = {
                "id": item["id"],
                "skill": skill["name"],
                "query": item["query"],
                "expected": "trigger" if item["should_trigger"] else "do_not_trigger",
                "attempts": attempts,
            }
            if classification:
                record.update({
                    "decision": classification.decision,
                    "confidence": classification.confidence,
                    "rationale": classification.rationale,
                })
                if classification.decision == "uncertain" or classification.confidence < confidence_threshold:
                    record["status"] = "uncertain"
                elif classification.decision != record["expected"]:
                    record["status"] = "disagreement"
                else:
                    record["status"] = "included"
            else:
                record.update({"status": error or "provider_failure", "error": error})
            records.append(record)
    return records


def metrics(records: Iterable[dict[str, Any]]) -> dict[str, Any]:
    records = list(records)
    included = [r for r in records if r["status"] in {"included", "disagreement"}]
    tp = sum(r["expected"] == "trigger" and r.get("decision") == "trigger" for r in included)
    fp = sum(r["expected"] == "do_not_trigger" and r.get("decision") == "trigger" for r in included)
    fn = sum(r["expected"] == "trigger" and r.get("decision") == "do_not_trigger" for r in included)
    tn = sum(r["expected"] == "do_not_trigger" and r.get("decision") == "do_not_trigger" for r in included)
    return {
        "evaluated": len(included),
        "excluded": len(records) - len(included),
        "accuracy": (tp + tn) / len(included) if included else None,
        "precision": tp / (tp + fp) if tp + fp else None,
        "recall": tp / (tp + fn) if tp + fn else None,
        "false_positive_rate": fp / (fp + tn) if fp + tn else None,
        "false_negative_rate": fn / (fn + tp) if fn + tp else None,
        "confusion": {"true_positive": tp, "false_positive": fp, "true_negative": tn, "false_negative": fn},
    }


def review_queue(records: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": r["id"],
            "skill": r["skill"],
            "query": r["query"],
            "expected": r["expected"],
            "gemini": {k: r[k] for k in ("decision", "confidence", "rationale") if k in r},
            "error": r.get("error"),
            "reason": r["status"],
            "manual_decision": None,
            "manual_reason": None,
        }
        for r in records
        if r["status"] in {"provider_unavailable", "provider_failure", "invalid_output", "uncertain", "disagreement"}
    ]


def write_report(path: Path, result: dict[str, Any]) -> None:
    m = result["metrics"]
    lines = [
        "# Gemini skill-trigger benchmark",
        "",
        f"- Provider: **{result['provider']}**",
        f"- Model: **{result['model']}**",
        f"- Run at: **{result['run_at']}**",
        "- Scope: Gemini classification only; this is not evidence of Claude behavior or Claude tool selection.",
        "",
        "## Metrics",
        "",
        f"- Evaluated: **{m['evaluated']}**; excluded: **{m['excluded']}**",
        f"- Accuracy: **{_number(m['accuracy'])}**",
        f"- Precision: **{_number(m['precision'])}**",
        f"- Recall: **{_number(m['recall'])}**",
        f"- False-positive rate: **{_number(m['false_positive_rate'])}**",
        f"- False-negative rate: **{_number(m['false_negative_rate'])}**",
        "",
        "Excluded cases are not treated as do-not-trigger decisions. See the manual-review queue for provider failures, invalid or uncertain responses, and disagreements.",
    ]
    path.write_text("\n".join(lines) + "\n")


PROVIDER_FAILURE_STATUSES = {
    "provider_unavailable",
    "provider_failure",
    "invalid_output",
}


def provider_failure_cases(records: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [record for record in records if record["status"] in PROVIDER_FAILURE_STATUSES]


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise SystemExit(f"File not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise SystemExit(f"Expected a JSON object in {path}")
    return value


def _manual_decisions(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    value = _read_json_object(path)
    decisions = value.get("decisions", [])
    if not isinstance(decisions, list) or not all(isinstance(item, dict) for item in decisions):
        raise SystemExit(f"Expected a decisions array in {path}")
    return decisions


def _queue_cases(path: Path) -> list[dict[str, Any]]:
    value = _read_json_object(path)
    cases = value.get("cases")
    if not isinstance(cases, list) or not all(isinstance(item, dict) for item in cases):
        raise SystemExit(f"Expected a cases array in {path}")
    return cases


def list_review_cases(queue_path: Path, decisions_path: Path) -> list[dict[str, Any]]:
    decisions = {item.get("id") for item in _manual_decisions(decisions_path)}
    return [case for case in _queue_cases(queue_path) if case.get("id") not in decisions]


def record_manual_decision(
    queue_path: Path,
    decisions_path: Path,
    case_id: str,
    decision: str,
    reason: str,
) -> dict[str, Any]:
    if decision not in DECISIONS - {"uncertain"}:
        raise SystemExit("manual decision must be trigger or do_not_trigger")
    reason = reason.strip()
    if not reason:
        raise SystemExit("manual reason must not be empty")
    if len(reason) > MAX_MANUAL_REASON_CHARS:
        raise SystemExit(f"manual reason must be {MAX_MANUAL_REASON_CHARS} characters or fewer")

    cases = _queue_cases(queue_path)
    case = next((case for case in cases if case.get("id") == case_id), None)
    if case is None:
        raise SystemExit(f"Review case not found in {queue_path}: {case_id}")

    existing = _manual_decisions(decisions_path)
    if any(item.get("id") == case_id for item in existing):
        raise SystemExit(f"Manual decision already recorded for {case_id}")

    entry = {
        "id": case_id,
        "decision": decision,
        "reason": reason,
    }
    payload = {
        "provider": "manual",
        "source": str(queue_path),
        "manual_decisions_excluded_from_metrics": True,
        "decisions": [*existing, entry],
    }
    decisions_path.write_text(json.dumps(payload, indent=2) + "\n")
    return entry


def _review_command(args: argparse.Namespace) -> None:
    if args.review_action == "list":
        cases = list_review_cases(args.queue, args.decisions)
        for case in cases:
            print(f"{case['id']}\t{case.get('skill', '')}\t{case.get('reason', '')}")
        print(f"{len(cases)} pending case(s)")
        return
    entry = record_manual_decision(
        args.queue, args.decisions, args.id, args.decision, args.reason
    )
    print(json.dumps(entry, indent=2))


def _number(value: Any) -> str:
    return "N/A" if value is None else f"{value:.3f}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", nargs="?", choices=("benchmark", "review"), default="benchmark")
    parser.add_argument(
        "review_action_positional",
        nargs="?",
        choices=("list", "decide"),
        help="review action (use with the review command)",
    )
    parser.add_argument("--corpus", type=Path, default=Path("skill-trigger-benchmark.json"))
    parser.add_argument("--results", type=Path, default=Path("gemini-skill-trigger-benchmark.json"))
    parser.add_argument("--report", type=Path, default=Path("gemini-skill-trigger-benchmark.md"))
    parser.add_argument("--queue", type=Path, default=Path("gemini-skill-trigger-review-queue.json"))
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--confidence-threshold", type=float, default=DEFAULT_CONFIDENCE)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument(
        "--fail-on-provider-error",
        action="store_true",
        help="exit non-zero after writing artifacts when Gemini has provider or structured-output failures",
    )
    parser.add_argument(
        "--decisions",
        type=Path,
        default=DEFAULT_MANUAL_DECISIONS,
        help="separate artifact for manual review decisions",
    )
    parser.add_argument("--review-action", choices=("list", "decide"))
    parser.add_argument("--id", help="review case ID for --review-action decide")
    parser.add_argument("--decision", choices=("trigger", "do_not_trigger"))
    parser.add_argument("--reason", help="reason for a manual decision")
    args = parser.parse_args()
    if args.command == "review":
        review_action = args.review_action or args.review_action_positional
        if not review_action:
            parser.error("review requires --review-action list or decide")
        if review_action == "decide" and not args.id:
            parser.error("review decide requires --id")
        if review_action == "decide" and not args.decision:
            parser.error("review decide requires --decision")
        if review_action == "decide" and args.reason is None:
            parser.error("review decide requires --reason")
        args.review_action = review_action
        _review_command(args)
        return
    corpus = json.loads(args.corpus.read_text())
    adapter = GeminiAdapter(model=args.model)
    records = evaluate(corpus, adapter, args.confidence_threshold, args.retries)
    result = {
        "provider": "gemini",
        "model": args.model,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "claude_evidence": "unavailable and intentionally unchanged",
        "metrics": metrics(records),
        "results": records,
    }
    args.results.write_text(json.dumps(result, indent=2) + "\n")
    args.queue.write_text(json.dumps({"provider": "gemini", "manual_decisions_excluded_from_metrics": True, "cases": review_queue(records)}, indent=2) + "\n")
    write_report(args.report, result)
    print(json.dumps({"provider": "gemini", "evaluated": result["metrics"]["evaluated"], "excluded": result["metrics"]["excluded"]}, indent=2))
    if args.fail_on_provider_error:
        failures = provider_failure_cases(records)
        if failures:
            print(
                "Gemini provider health check failed for: "
                + ", ".join(f"{record['id']} ({record['status']})" for record in failures),
                file=sys.stderr,
            )
            raise SystemExit(1)


if __name__ == "__main__":
    main()