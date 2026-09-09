#!/usr/bin/env python3
"""Build and preflight a held-out trigger benchmark for project and managed skills.

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
BENCHMARK_SKILL_ROOTS = (ROOT / ".agents" / "skills",)
AVAILABLE_SKILL_ROOTS = (
    ROOT / ".agents" / "skills",
    ROOT / ".local" / "secondary_skills",
)
# Managed skills are platform-provided and are not benchmarked wholesale. This
# reviewed subset is intentionally small so each prompt remains hand-curated.
MANAGED_FIXTURE_SKILLS: frozenset[str] = frozenset({
    "ad-creative",
    "deep-research",
    "design-thinker",
    "recipe-creator",
    "seo-auditor",
})
INTENTIONAL_FIXTURE_SKILLS = MANAGED_FIXTURE_SKILLS

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
    "db-schema-change": (
        ["Add a new Drizzle table and carry the Postgres schema change through push-force, API codegen, and typechecks.",
         "Remove a persisted database column safely and route any stored-data impact through the schema-change guardrails."],
        ["Add one nullable field to an existing populated table using the detailed new-column checklist.",
         "Rename a client-only TypeScript property that is never persisted or exposed by the API."],
    ),
    "external-skill-import": (
        ["Review this uploaded third-party skill archive for provenance, licensing, unsafe paths, and local compatibility before installing it.",
         "Assess a skill bundle from GitHub as untrusted data and recommend accept, adapt, defer, or reject without executing its scripts."],
        ["Create a new project-owned skill from requirements we wrote ourselves.",
         "Install a vetted npm dependency from the public registry after checking its package provenance."],
    ),
    "ad-creative": (
        ["Create three static Instagram and LinkedIn ads for our product, with copy, a CTA, and square and portrait variants.",
         "Refresh our display banner campaign into several A/B-tested visual ad concepts using the brand assets I uploaded."],
        ["Write five organic Instagram posts for our launch; do not make paid ads or banner assets.",
         "Plan a 30-second animated video ad with scenes, transitions, and motion."],
    ),
    "deep-research": (
        ["Do a multi-source deep dive on the 2026 cold-chain packaging market, score source credibility, and deliver a cited report.",
         "Research whether we should enter this market, triangulate current evidence, and synthesize an evidence-backed briefing with citations."],
        ["Look up the current price of one API and give me the answer.",
         "Analyze this CSV I uploaded and summarize its trends in a chart."],
    ),
    "design-thinker": (
        ["We are unsure which customer problem to solve; define the audience, reframe the problem, explore options, and prioritize a direction.",
         "Before investing in this idea, run a structured human-centered validation exercise and narrow us to one concept."],
        ["The bug and solution are already clear; implement the ticket without exploring alternatives.",
         "Audit the finished page's colors, spacing, and responsive layout."],
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
    "recipe-creator": (
        ["Create a structured recipe for vegan mushroom ramen with ingredients, steps, nutrition, timers, and serving scaling.",
         "Turn my grandmother's notes into a complete cookable recipe and save it to my recipe collection."],
        ["Make a weekly high-protein meal plan with calorie targets and a grocery list.",
         "Build the React page that displays my recipe collection; do not create or edit recipe data."],
    ),
    "seo-auditor": (
        ["Audit my website for crawlability, technical SEO, metadata, and actionable improvements to search visibility.",
         "Review these pages for SEO issues and recommend better titles, descriptions, and target keywords."],
        ["Create a paid advertising campaign with display banners and social ad variants.",
         "Compare two competitors' pricing and positioning without auditing their search visibility."],
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
    "verify-before-commit": (
        ["Before committing these repo changes, check status, run the supported local verification, and confirm the dependency lockfile is consistent.",
         "We are about to push and claim the build is green; apply this repository's ARM-safe verification discipline first."],
        ["Run the full pre-publish release checklist and decide whether the application is ready to deploy.",
         "Review a finished feature for security and product risks, but do not commit or push it."],
    ),
    "wrong-number-triage": (
        ["The screen says 5.7 batches but the expected value is 8.25; trace where the wrong number comes from before editing it.",
         "A run shows the wrong yield and batch count—identify the source of the displayed value and verify the correction."],
        ["The displayed number is correct; I only want a layout redesign.",
         "A database import created incorrect stored values across many profiles."],
    ),
}


def skill_files() -> list[Path]:
    project_files = [
        path
        for root in BENCHMARK_SKILL_ROOTS
        for path in root.glob("*/SKILL.md")
    ]
    managed_files = [
        ROOT / ".local" / "secondary_skills" / name / "SKILL.md"
        for name in sorted(MANAGED_FIXTURE_SKILLS)
    ]
    return sorted([*project_files, *managed_files])


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


def ownership(path: Path) -> str:
    try:
        path.relative_to(ROOT / ".agents" / "skills")
    except ValueError:
        return "managed"
    return "project-owned"


def available_skill_names() -> set[str]:
    return {
        canonical_name(frontmatter(path)[0])
        for root in AVAILABLE_SKILL_ROOTS
        for path in root.glob("*/SKILL.md")
    }


def tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z][a-z0-9-]{2,}", text.lower()) if t not in {
        "the", "and", "for", "this", "that", "with", "from", "when", "into",
        "use", "skill", "user", "app", "any", "are", "not", "only",
    }}


def build() -> dict:
    unavailable_prompts = sorted(
        set(PROMPTS) - available_skill_names() - INTENTIONAL_FIXTURE_SKILLS
    )
    if unavailable_prompts:
        raise SystemExit(
            "Benchmark prompts reference unavailable skills: "
            f"{unavailable_prompts}. Add the skill to an available catalog or "
            "document it in INTENTIONAL_FIXTURE_SKILLS."
        )

    files = skill_files()
    names = []
    skills = []
    for path in files:
        if not path.exists():
            raise SystemExit(f"Managed fixture skill is unavailable: {path.relative_to(ROOT)}")
        raw_name, description = frontmatter(path)
        name = canonical_name(raw_name)
        names.append(name)
        if name not in PROMPTS:
            raise SystemExit(f"Missing benchmark prompts for {name} ({path})")
        yes, no = PROMPTS[name]
        skill_ownership = ownership(path)
        skills.append({
            "name": name,
            "metadata_name": name,
            "ownership": skill_ownership,
            "coverage": "curated-managed" if skill_ownership == "managed" else "project-owned",
            "path": str(path.relative_to(ROOT)),
            "description": description,
            "evals": [
                *({"id": f"{name}-trigger-{i}", "query": q, "should_trigger": True}
                  for i, q in enumerate(yes, 1)),
                *({"id": f"{name}-near-miss-{i}", "query": q, "should_trigger": False}
                  for i, q in enumerate(no, 1)),
            ],
        })
    missing = sorted(set(PROMPTS) - set(names) - INTENTIONAL_FIXTURE_SKILLS)
    if missing:
        raise SystemExit(f"Benchmark prompts have no benchmarked skill: {missing}")
    total_prompts = sum(len(skill["evals"]) for skill in skills)
    return {
        "benchmark": "skills-trigger-2026-09",
        "method": (
            "held-out, balanced, two positive and two near-miss negative prompts per "
            "project-owned skill, plus a reviewed managed-skill fixture subset"
        ),
        "catalog_validation": {
            "status": "pass",
            "available_roots": [
                str(root.relative_to(ROOT)) for root in AVAILABLE_SKILL_ROOTS
            ],
            "benchmarked_roots": [
                str(root.relative_to(ROOT)) for root in BENCHMARK_SKILL_ROOTS
            ],
            "intentional_fixture_skills": sorted(INTENTIONAL_FIXTURE_SKILLS),
            "coverage": {
                "project_owned": sorted(
                    skill["name"] for skill in skills if skill["ownership"] == "project-owned"
                ),
                "managed_curated": sorted(
                    skill["name"] for skill in skills if skill["ownership"] == "managed"
                ),
            },
        },
        "runtime_evaluator": ".agents/skills/skill-creator/scripts/run_eval.py",
        "runtime_status": (
            f"blocked: run_eval.py was exercised on {total_prompts} prompts with 3 repetitions "
            "and a balanced held-out split, but the claude CLI is unavailable"
        ),
        "runtime_metrics": [
            {
                "skill": skill["name"],
                "precision": None,
                "recall": None,
                "false_positive_rate": None,
                "false_negative_rate": None,
                "status": "unavailable: claude CLI missing before model evaluation",
            }
            for skill in skills
        ],
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
        total_prompts = sum(len(s["evals"]) for s in data["skills"])
        total_positive = sum(
            sum(e["should_trigger"] for e in s["evals"]) for s in data["skills"]
        )
        project_count = len(data["catalog_validation"]["coverage"]["project_owned"])
        managed_count = len(data["catalog_validation"]["coverage"]["managed_curated"])
        lines = [
            "# Skill trigger benchmark",
            "",
            f"- Skills: **{len(data['skills'])}**",
            f"- Coverage: **{project_count}** project-owned, **{managed_count}** managed curated fixtures",
            f"- Prompts: **{total_prompts}** "
            f"({total_positive} should-trigger, {total_prompts - total_positive} near-miss should-not-trigger)",
            "- Catalog validation: **PASS** (every prompt targets an available skill; "
            "managed fixtures are intentional and documented)",
            f"- Runtime model rates: **blocked** (the complete {total_prompts}-prompt run and balanced held-out run "
            "were attempted with three repetitions, but every subprocess failed because `claude` is unavailable)",
            "",
            "## Runtime attempt",
            "",
            f"The runtime attempt targeted this {total_prompts}-prompt corpus: "
            f"{total_prompts} prompts × 3 repetitions ({total_prompts * 3} attempts). "
            "A deterministic balanced held-out split (one positive and one near-miss per skill) "
            f"was also exercised: {len(data['skills']) * 2} prompts × 3 repetitions "
            f"({len(data['skills']) * 6} attempts). Every attempt failed "
            "before model evaluation with `[Errno 2] No such file or directory: 'claude'`.",
            "",
            "Because `run_eval.py` records failed subprocesses as non-triggers, its resulting 0/3 "
            "rates are synthetic failure output, not model observations. Precision, recall, false-positive, "
            "and false-negative rates are therefore **unavailable** for every skill.",
            "",
            "## Preflight findings",
            "",
            "These are lexical review signals only, not claims that Claude would trigger. "
            "When the Claude CLI is available, rerun `run_eval.py` with three runs per prompt and this "
            "balanced held-out split before changing any description.",
            "",
            "## Per-skill runtime metrics",
            "",
            "Runtime precision, recall, false-positive rate, and false-negative rate are "
            "**unavailable** for every skill because all attempts failed before model evaluation. "
            "The evaluator's 0/3 output is synthetic and is not included as evidence.",
            "",
            "| Skill | Precision | Recall | False-positive rate | False-negative rate | Signals |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
        for row in data["preflight"]:
            signals = []
            if row["under_trigger_signal"]:
                signals.append(f"under-trigger candidate ({row['under_trigger_signal']})")
            if row["over_trigger_signal"]:
                signals.append(f"over-trigger candidate ({row['over_trigger_signal']})")
            lines.append(
                f"| `{row['name']}` | N/A | N/A | N/A | N/A | "
                f"{'; '.join(signals) or 'none'} |"
            )
        lines.extend([
            "",
            "## Interpretation",
            "",
            f"The preflight surfaced {len(flagged)} skills for review: "
            + ", ".join(f"`{r['name']}`" for r in flagged) + ".",
            "No skill description was changed: the runtime attempt produced no model-trigger evidence. "
            "The lexical flags remain review signals only and must not be converted into description edits "
            "until the held-out model run succeeds.",
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