#!/usr/bin/env python3
"""Build and preflight a held-out trigger benchmark for editable skills.

The production-grade evaluator is skill-creator/scripts/run_eval.py, which
asks Claude whether each skill is consulted. This script intentionally does
not pretend to be a model: when Claude is unavailable it checks corpus
balance, description coverage, and near-miss separation so the benchmark is
still reviewable and repeatable.

Usage:
  python scripts/skill_trigger_benchmark.py
  python scripts/skill_trigger_benchmark.py --write benchmark.json
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOTS = (ROOT / ".agents" / "skills", ROOT / ".local" / "custom_skills")

# Four deliberately substantive prompts per skill: one clear and one casual
# positive, plus two adjacent negative cases. The negatives share vocabulary
# with the skill and are therefore useful near-misses rather than easy rejects.
PROMPTS: dict[str, tuple[list[str], list[str]]] = {
    "brainstorming": (
        ["Help me design a new customer-facing workflow before anyone writes code.",
         "I have a fuzzy product idea; explore the intent, compare approaches, and get approval on a design first."],
        ["Implement this small fix directly; do not spend time exploring alternatives.",
         "Review the finished API implementation for bugs and type errors."],
    ),
    "customer-import-audit": (
        ["A new customer's workbook was imported yesterday; audit what landed in profiles and pools and tell me if it is correct.",
         "Please verify the imported brand's recipes, links, and names without changing the importer or repairing data."],
        ["The Excel parser linked a recipe to the wrong flavor; trace the bug and fix the poisoned records.",
         "I need to import a new workbook and build the customer setup from scratch."],
    ),
    "data-heal-playbook": (
        ["An importer saved the wrong yield into hundreds of profiles; diagnose the stored damage and ship a one-time data heal.",
         "The bug is fixed but production rows are already poisoned—repair persisted profiles safely and verify the heal."],
        ["A new workbook was imported; only audit whether the result is correct, do not repair anything.",
         "The UI displays the wrong number, but no incorrect value has been saved yet."],
    ),
    "import-bug-investigation": (
        ["The cheese Excel import skipped several varieties and created duplicate links; trace parse versus apply versus pool data.",
         "A premix workbook misnamed recipes after import—investigate which layer produced the bad result before changing code."],
        ["The import is correct, but old profile rows must be repaired with a one-time migration.",
         "Please add a new column to the mixes database table."],
    ),
    "operational-browser-verification": (
        ["Verify the manager queue in a real browser: authorization, scoped navigation, queue action, reload persistence, and startup health.",
         "Unit tests pass; collect browser evidence that a manager can reopen an import review and complete the operational workflow."],
        ["Add a Playwright unit test for a pure date formatter.",
         "Compare two screenshots visually and update the accessibility snapshots."],
    ),
    "production-go": (
        ["Is this app ready to go live? Run the applicable release gates and give one bounded GO or NO-GO decision.",
         "Can we safely publish this application today, including production safety and deployment readiness?"],
        ["Please run the pre-publish checklist before I decide whether to deploy.",
         "The production deploy is broken; investigate its server logs and repair the incident."],
    ),
    "release-checklist": (
        ["Before publishing, run the app's release tests, typechecks, workflow restart, and live-data-heal checks.",
         "I want the pre-publish verification checklist completed before we suggest a deployment."],
        ["Give me a final production-ready GO or NO-GO decision.",
         "A deployed app is returning 500s; diagnose production rather than running release gates."],
    ),
    "rollback-recovery": (
        ["After restoring an old checkpoint, recover the missing post-merge behavior incrementally and prove parity without replacing the branch wholesale.",
         "The rollback removed a feature; compare against a named baseline and safely restore only what is missing."],
        ["Implement a normal feature on the current branch with no rollback or restore involved.",
         "Revert the last commit because the user wants a simple undo of their local edit."],
    ),
    "schema-change-checklist": (
        ["Add an isPrep column to an existing populated production-rules table and update the schema, API, and migration safely.",
         "Extend a persisted database entity with a new field; make sure push-force and additive migration safety are covered."],
        ["Rename a TypeScript interface field that is never persisted.",
         "Add a CSS class and a client-only form value; there is no database schema change."],
    ),
    "skill-creator": (
        ["Improve an existing skill's trigger description and measure it with should-trigger and should-not-trigger held-out prompts.",
         "Create or optimize a reusable skill, then run a bounded evaluation and report its results."],
        ["Use the existing release checklist to validate this application before publishing.",
         "Write a one-off README section describing today's implementation."],
    ),
    "spec-import-guard": (
        ["I changed the spec Excel parser and prompt; run the import guard, corpus checks, and alias safety checks before merging.",
         "This work touches split-grid merge logic and spec export—apply the specialist import regression checklist."],
        ["Investigate a bad imported workbook by tracing what landed in the database.",
         "Add a new server column unrelated to spec parsing or exports."],
    ),
    "state-accuracy-check": (
        ["I changed the live run timer and autosave math; verify counters, pause/resume, dough supply, and press completion remain accurate.",
         "After modifying LiveRunContext, check that timers and production counts stay consistent across live state updates."],
        ["Change a static settings page that does not read live run state.",
         "Audit SSE merge stamps and stale writes across multiple devices."],
    ),
    "sync-invariant-check": (
        ["I changed routes/sync.ts and the SSE receive merge; check epochs, stamps, reset behavior, and stale-write invariants.",
         "Review this day-state synchronization change for awake-device handoff and non-clobber guarantees."],
        ["Change a local-only timer with no sync or day-state involvement.",
         "Verify a manager's browser workflow in a real browser."],
    ),
    "test-gap-triage": (
        ["A bug report needs coverage; classify the source of truth and choose the smallest effective regression test and specialist safety checks.",
         "Where should this feature test go? Triage the gap before proposing a new test task."],
        ["Run the existing test suite and fix the failing assertion immediately.",
         "Design a new product workflow before implementation."],
    ),
    "wrong-number-triage": (
        ["The screen says 5.7 batches but the expected value is 8.25; trace where the wrong number comes from before editing it.",
         "A run shows the wrong yield and batch count—identify the source of the displayed value and verify the correction."],
        ["The displayed number is correct; I only want a layout redesign.",
         "A database import created incorrect stored values across many profiles."],
    ),
    "check-dependency-licenses": (
        ["Before release, audit every production dependency for license policy violations and document any blocked package.",
         "Check the npm dependency tree for license compliance, including transitive packages, before we ship."],
        ["Add a new package and verify it is genuine before installing it.",
         "Scan the application for SQL injection and XSS vulnerabilities."],
    ),
    "handle-personal-and-sensitive-data": (
        ["This feature processes customer addresses and private account details; design the data flow with minimization, access controls, and retention limits.",
         "Review how we collect and store personal information and sensitive data, and prevent it leaking into logs or analytics."],
        ["Validate a public URL parameter against an allow-list.",
         "Add a password reset flow using the existing authentication system."],
    ),
    "instrument-observability-and-graceful-errors": (
        ["Add bounded structured events, correlation IDs, useful timing, and safe user-facing errors to this production workflow.",
         "Instrument this API so failures are observable without logging request payloads or secrets, and degrade gracefully."],
        ["Add authentication and role checks to the endpoint.",
         "Add SQL parameterization and HTML escaping for form input."],
    ),
    "make-apps-resilient-to-abuse-and-overload": (
        ["A public endpoint can be spammed and expensive requests can exhaust the service; add rate limits, quotas, timeouts, and overload behavior.",
         "Make this app resilient to abuse and traffic spikes without exposing whether protected records exist."],
        ["Add a responsive tablet layout for the dashboard.",
         "Review personal-data retention and privacy controls."],
    ),
    "make-ui-responsive-across-devices": (
        ["The dashboard works at desktop width but breaks on phones and tablets; make the real UI usable across screen sizes.",
         "Build this customer-facing form so it is responsive on mobile, tablet, and desktop rather than only the preview width."],
        ["Make the API tolerate traffic spikes and abusive callers.",
         "Run an accessibility audit for keyboard navigation and screen readers."],
    ),
    "meet-an-accessibility-baseline": (
        ["Audit this app for keyboard access, labels, focus management, contrast, and screen-reader semantics, then fix the blockers.",
         "Before shipping the new dialog, establish an accessibility baseline and verify it across representative viewports."],
        ["Make the layout responsive across phone and desktop widths.",
         "Benchmark whether a skill description triggers for realistic prompts."],
    ),
    "review-before-shipping": (
        ["Review this completed change before release for security, authorization, data safety, tests, and deploy readiness.",
         "Do a final risk-based shipping review and report blockers, evidence, and explicit exceptions."],
        ["Run only the pre-publish release checklist and its configured commands.",
         "Design the feature architecture before any implementation begins."],
    ),
    "secure-ai-features-against-prompt-injection": (
        ["Build an AI assistant that summarizes uploaded documents and can call tools; defend against prompt injection and excessive agency.",
         "User text and web pages will be sent to an LLM—secure the feature against instruction hijacking and unauthorized actions."],
        ["Validate ordinary form fields and encode them for HTML output; no LLM is involved.",
         "Add a conventional password login with no AI or external content."],
    ),
    "validate-and-encode-untrusted-input": (
        ["This endpoint accepts JSON, path parameters, uploads, and webhook data; add allow-list validation, safe queries, and contextual output encoding.",
         "Harden the API against SQL injection, XSS, and SSRF from user input and third-party responses."],
        ["Design defenses for prompt injection in an LLM agent.",
         "Audit how customer PII is retained and who can access it."],
    ),
    "vet-dependencies-before-adding": (
        ["I want to install a new npm package for spreadsheet parsing; verify the registry package, provenance, typosquat risk, and compatibility first.",
         "Before adding or upgrading this pip dependency, vet that it is genuine and safe rather than blindly editing the manifest."],
        ["Audit the license of packages already in the production dependency tree.",
         "Fix a parser bug in an existing dependency-free module."],
    ),
}


def skill_files() -> list[Path]:
    return sorted(p for root in SKILL_ROOTS for p in root.glob("*/SKILL.md"))


def frontmatter(path: Path) -> tuple[str, str]:
    text = path.read_text()
    block = text.split("---", 2)[1]
    name = re.search(r"^name:\s*(.+)$", block, re.MULTILINE).group(1).strip().strip("\"'")
    description = re.search(
        r"^description:\s*(?:[>|][-+]?\s*)?(.+)$", block, re.MULTILINE
    )
    if not description:
        # Folded/block descriptions are uncommon here; retain the complete
        # frontmatter block for the preflight rather than silently dropping it.
        description_text = block
    else:
        description_text = description.group(1).strip().strip("\"'")
    return name, description_text


def canonical_name(name: str) -> str:
    """Match legacy display-case metadata to the directory-style key."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z][a-z0-9-]{2,}", text.lower()) if t not in {
        "the", "and", "for", "this", "that", "with", "from", "when", "into",
        "use", "skill", "user", "app", "any", "are", "not", "only",
    }}


def build() -> dict:
    files = skill_files()
    names = []
    skills = []
    for path in files:
        raw_name, description = frontmatter(path)
        name = canonical_name(raw_name)
        names.append(name)
        if name not in PROMPTS:
            raise SystemExit(f"Missing benchmark prompts for {name} ({path})")
        yes, no = PROMPTS[name]
        skills.append({
            "name": name,
            "metadata_name": raw_name,
            "path": str(path.relative_to(ROOT)),
            "description": description,
            "evals": [
                *({"id": f"{name}-trigger-{i}", "query": q, "should_trigger": True}
                  for i, q in enumerate(yes, 1)),
                *({"id": f"{name}-near-miss-{i}", "query": q, "should_trigger": False}
                  for i, q in enumerate(no, 1)),
            ],
        })
    missing = sorted(set(PROMPTS) - set(names))
    if missing:
        raise SystemExit(f"Benchmark prompts have no editable skill: {missing}")
    return {
        "benchmark": "editable-skills-trigger-2026-08",
        "method": "held-out, balanced, two positive and two near-miss negative prompts per skill",
        "runtime_evaluator": ".agents/skills/skill-creator/scripts/run_eval.py",
        "runtime_status": "not-run: claude CLI unavailable in this environment",
        "skills": skills,
    }


def preflight(data: dict) -> list[dict]:
    report = []
    for skill in data["skills"]:
        desc_tokens = tokens(skill["description"] + " " + skill["name"])
        positive = [len(tokens(e["query"]) & desc_tokens) for e in skill["evals"] if e["should_trigger"]]
        negative = [len(tokens(e["query"]) & desc_tokens) for e in skill["evals"] if not e["should_trigger"]]
        # These are review signals, not model-trigger claims.
        under = sum(score < 2 for score in positive)
        over = sum(score >= 5 for score in negative)
        status = "review" if under or over else "no lexical flag"
        report.append({
            "name": skill["name"],
            "positive_overlap": positive,
            "negative_overlap": negative,
            "under_trigger_signal": under,
            "over_trigger_signal": over,
            "status": status,
        })
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    data = build()
    data["preflight"] = preflight(data)
    if args.write:
        args.write.write_text(json.dumps(data, indent=2) + "\n")
    if args.report:
        flagged = [r for r in data["preflight"] if r["status"] == "review"]
        lines = [
            "# Editable skills trigger benchmark",
            "",
            f"- Skills: **{len(data['skills'])}**",
            f"- Prompts: **{sum(len(s['evals']) for s in data['skills'])}** "
            f"({sum(sum(e['should_trigger'] for e in s['evals']) for s in data['skills'])} should-trigger, "
            f"{sum(sum(not e['should_trigger'] for e in s['evals']) for s in data['skills'])} near-miss should-not-trigger)",
            "- Runtime model rates: **not run** (Claude CLI is unavailable in this environment)",
            "",
            "## Preflight findings",
            "",
            "These are lexical review signals only, not claims that Claude would trigger. "
            "A real run should use `run_eval.py` with three runs per prompt and a 40% held-out split.",
            "",
            "| Skill | Positive overlap | Negative overlap | Signals |",
            "| --- | --- | --- | --- |",
        ]
        for row in data["preflight"]:
            signals = []
            if row["under_trigger_signal"]:
                signals.append(f"under-trigger candidate ({row['under_trigger_signal']})")
            if row["over_trigger_signal"]:
                signals.append(f"over-trigger candidate ({row['over_trigger_signal']})")
            lines.append(
                f"| `{row['name']}` | {row['positive_overlap']} | {row['negative_overlap']} | "
                f"{'; '.join(signals) or 'none'} |"
            )
        lines.extend([
            "",
            "## Interpretation",
            "",
            f"The preflight surfaced {len(flagged)} skills for review: "
            + ", ".join(f"`{r['name']}`" for r in flagged) + ".",
            "No skill description was changed from this proxy alone. Description edits "
            "require model-trigger evidence on held-out prompts; the corpus is ready "
            "for that run when the Claude CLI is available.",
        ])
        args.report.write_text("\n".join(lines) + "\n")
    print(json.dumps({
        "skills": len(data["skills"]),
        "evals": sum(len(s["evals"]) for s in data["skills"]),
        "should_trigger": sum(sum(e["should_trigger"] for e in s["evals"]) for s in data["skills"]),
        "should_not_trigger": sum(sum(not e["should_trigger"] for e in s["evals"]) for s in data["skills"]),
        "review_signals": [r["name"] for r in data["preflight"] if r["status"] == "review"],
        "runtime_status": data["runtime_status"],
    }, indent=2))


if __name__ == "__main__":
    main()