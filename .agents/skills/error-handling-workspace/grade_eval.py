#!/usr/bin/env python3
"""Grade the retained PWA recovery guidance responses against bounded checks."""

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
EVALS = Path(".agents/skills/error-handling/evals/evals.json")
ITERATIONS = {
    "iteration-1": [
        "stale-home-pre-home-safety",
        "exact-safari-notification-error",
        "unrelated-chunk-network-failure",
    ],
    "iteration-2": [
        "stale-home-pre-home-safety",
        "exact-safari-notification-error",
        "unrelated-chunk-network-failure",
    ],
}


def has(text: str, *patterns: str) -> bool:
    return all(re.search(pattern, text, re.IGNORECASE | re.DOTALL) for pattern in patterns)


def grade(eval_id: int, text: str) -> list[tuple[bool, str]]:
    text = re.sub(r"[*_`]", "", text).replace("’", "'")
    if eval_id == 1:
        return [
            (
                has(text, r"\.agents/memory/pwa-update-prompts\.md|PWA update policy"),
                "PWA policy source is cited or named."
                if has(text, r"\.agents/memory/pwa-update-prompts\.md|PWA update policy")
                else "No PWA policy source or route is named.",
            ),
            (
                has(text, r"authenticated", r"complete", r"server snapshot", r"local snapshot",
                    r"same day|today|current client day", r"no active run",
                    r"unsafe", r"until both.{0,30}verified|unknown|malformed|unavailable|mismatched"),
                "Response names authenticated complete server and matching-day local snapshots, plus no active run."
                if has(text, r"authenticated", r"complete", r"server snapshot", r"local snapshot",
                       r"same day|today|current client day", r"no active run",
                       r"unsafe", r"until both.{0,30}verified|unknown|malformed|unavailable|mismatched")
                else "Response does not state all trusted current-day snapshot and no-active-run conditions.",
            ),
            (
                has(text, r"one (?:uninterrupted )?minute", r"recheck", r"worker recovery"),
                "Response retains the one-minute idle interval and recheck before worker recovery."
                if has(text, r"one (?:uninterrupted )?minute", r"recheck", r"worker recovery")
                else "Response omits the one-minute idle interval and/or recheck before worker recovery.",
            ),
            (
                has(text, r"do not .{0,40}(?:refresh|reload)|don't .{0,40}(?:refresh|reload)|unsafe.*(?:reload|refresh)"),
                "Response refuses blind reload while safety is unknown."
                if has(text, r"do not .{0,40}(?:refresh|reload)|don't .{0,40}(?:refresh|reload)|unsafe.*(?:reload|refresh)")
                else "Response does not clearly refuse a blind reload.",
            ),
        ]
    if eval_id == 2:
        return [
            (
                has(text, r"\.agents/memory/pwa-update-prompts\.md|PWA update policy"),
                "PWA policy source is cited or named."
                if has(text, r"\.agents/memory/pwa-update-prompts\.md|PWA update policy")
                else "No PWA policy source or route is named.",
            ),
            (
                has(text, r"Can't find variable: Notification", r"Update and reload"),
                "Exact Safari message and explicit Update and reload action are present."
                if has(text, r"Can't find variable: Notification", r"Update and reload")
                else "Exact error or prescribed Update and reload action is missing.",
            ),
            (
                has(text, r"after staff (?:choose|click)|after.*click", r"waiting (?:service )?(?:worker|update)",
                    r"(?:ordinary|normal) reload|no waiting worker"),
                "Worker check follows staff action and has an ordinary-reload fallback."
                if has(text, r"after staff (?:choose|click)|after.*click",
                       r"waiting (?:service )?(?:worker|update)",
                       r"(?:ordinary|normal) reload|no waiting worker")
                else "Worker-after-click behavior or ordinary-reload fallback is missing.",
            ),
            (
                has(text, r"(?:do not|don't).{0,30}(?:auto|automatic)|no automatic",
                    r"do not match|don't match|broad match|narrowly scoped|only when.*exact|exact Safari|do not offer.*every ReferenceError"),
                "Automatic reload and broad ReferenceError matching are rejected."
                if has(text, r"(?:do not|don't).{0,30}(?:auto|automatic)|no automatic",
                       r"do not match|don't match|broad match|narrowly scoped|only when.*exact|exact Safari|do not offer.*every ReferenceError")
                else "Response does not reject both automatic reload and broad ReferenceError matching.",
            ),
        ]
    if eval_id == 3:
        return [
            (
                has(text, r"(?:do not|don't|avoid|not use).{0,60}(?:stale-client|Update and reload)"),
                "503 is not routed to the special stale-client Update and reload path."
                if has(text, r"(?:do not|don't|avoid|not use).{0,60}(?:stale-client|Update and reload)")
                else "Response may misclassify the 503 or use the special stale-client path.",
            ),
            (
                has(text, r"unsaved", r"(?:keep|preserve|save|copy).{0,60}(?:input|form)|input.{0,60}(?:intact|preserv)")
                and has(text, r"do not reload|don't reload|without reloading|rather than reloading|before considering any reload"),
                "Unsaved input is preserved and reload is avoided."
                if has(text, r"unsaved", r"(?:keep|preserve|save|copy).{0,50}(?:input|form)|input.{0,50}(?:intact|preserv)",
                       r"do not reload|don't reload|without reloading|rather than reloading|before considering any reload")
                else "Response does not clearly preserve unsaved input while avoiding reload.",
            ),
            (
                has(text, r"retry.{0,80}(?:once|one|stable|connection)|(?:once|one).{0,80}retry|bounded"),
                "Response gives a bounded retry or diagnostic next step."
                if has(text, r"retry.{0,80}(?:once|one|stable|connection)|(?:once|one).{0,80}retry|bounded")
                else "Response lacks a bounded, non-destructive retry or diagnostic step.",
            ),
        ]
    raise ValueError(f"Unexpected eval id: {eval_id}")


def main() -> None:
    evals = json.loads(EVALS.read_text())["evals"]
    by_id = {item["id"]: item for item in evals}
    aggregate = {}
    for iteration, names in ITERATIONS.items():
        totals = {"with_skill": [0, 0], "old_skill": [0, 0]}
        for eval_id, name in enumerate(names, start=1):
            case = by_id[eval_id]
            case_dir = ROOT / iteration / f"eval-{eval_id}-{name}"
            for config in ("with_skill", "old_skill"):
                response_path = case_dir / config / "outputs/response.md"
                response = response_path.read_text()
                checks = grade(eval_id, response)
                expectations = [
                    {"text": label, "passed": passed, "evidence": evidence}
                    for label, (passed, evidence) in zip(case["expectations"], checks, strict=True)
                ]
                passed = sum(item["passed"] for item in expectations)
                total = len(expectations)
                (case_dir / config / "grading.json").write_text(
                    json.dumps(
                        {
                            "expectations": expectations,
                            "summary": {
                                "passed": passed,
                                "failed": total - passed,
                                "total": total,
                                "pass_rate": passed / total,
                            },
                        },
                        indent=2,
                    )
                    + "\n"
                )
                totals[config][0] += passed
                totals[config][1] += total
        aggregate[iteration] = {
            config: {
                "passed": counts[0],
                "total": counts[1],
                "pass_rate": counts[0] / counts[1],
            }
            for config, counts in totals.items()
        }
    print(json.dumps(aggregate, indent=2))


if __name__ == "__main__":
    main()
