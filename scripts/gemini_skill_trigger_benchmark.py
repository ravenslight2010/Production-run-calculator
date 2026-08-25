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


def _number(value: Any) -> str:
    return "N/A" if value is None else f"{value:.3f}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=Path("skill-trigger-benchmark.json"))
    parser.add_argument("--results", type=Path, default=Path("gemini-skill-trigger-benchmark.json"))
    parser.add_argument("--report", type=Path, default=Path("gemini-skill-trigger-benchmark.md"))
    parser.add_argument("--queue", type=Path, default=Path("gemini-skill-trigger-review-queue.json"))
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--confidence-threshold", type=float, default=DEFAULT_CONFIDENCE)
    parser.add_argument("--retries", type=int, default=2)
    args = parser.parse_args()
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


if __name__ == "__main__":
    main()