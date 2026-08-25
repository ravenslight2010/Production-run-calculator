# Editable skills trigger benchmark

- Skills: **25**
- Prompts: **100** (50 should-trigger, 50 near-miss should-not-trigger)
- Runtime model rates: **not run** (Claude CLI is unavailable in this environment)

## Preflight findings

These are lexical review signals only, not claims that Claude would trigger. A real run should use `run_eval.py` with three runs per prompt and a 40% held-out split.

| Skill | Positive overlap | Negative overlap | Signals |
| --- | --- | --- | --- |
| `brainstorming` | [2, 2] | [0, 1] | none |
| `customer-import-audit` | [5, 1] | [0, 4] | under-trigger candidate (1) |
| `data-heal-playbook` | [7, 5] | [0, 3] | none |
| `import-bug-investigation` | [6, 3] | [1, 0] | none |
| `operational-browser-verification` | [11, 4] | [1, 1] | none |
| `production-go` | [9, 2] | [5, 0] | over-trigger candidate (1) |
| `release-checklist` | [4, 3] | [0, 0] | none |
| `rollback-recovery` | [10, 6] | [4, 0] | none |
| `schema-change-checklist` | [3, 3] | [1, 1] | none |
| `skill-creator` | [4, 3] | [1, 0] | none |
| `spec-import-guard` | [5, 6] | [0, 1] | none |
| `state-accuracy-check` | [5, 4] | [2, 0] | none |
| `sync-invariant-check` | [0, 0] | [0, 0] | under-trigger candidate (2) |
| `test-gap-triage` | [10, 8] | [2, 2] | none |
| `wrong-number-triage` | [9, 5] | [1, 0] | none |
| `check-dependency-licenses` | [2, 3] | [1, 0] | none |
| `handle-personal-and-sensitive-data` | [1, 3] | [0, 0] | under-trigger candidate (1) |
| `instrument-observability-and-graceful-errors` | [3, 2] | [2, 1] | none |
| `make-apps-resilient-to-abuse-and-overload` | [7, 1] | [1, 0] | under-trigger candidate (1) |
| `make-ui-responsive-across-devices` | [4, 5] | [0, 0] | none |
| `meet-an-accessibility-baseline` | [1, 1] | [0, 0] | under-trigger candidate (2) |
| `review-before-shipping` | [1, 0] | [0, 1] | under-trigger candidate (2) |
| `secure-ai-features-against-prompt-injection` | [9, 6] | [1, 2] | none |
| `validate-and-encode-untrusted-input` | [10, 8] | [2, 0] | none |
| `vet-dependencies-before-adding` | [2, 4] | [1, 0] | none |

## Interpretation

The preflight surfaced 7 skills for review: `customer-import-audit`, `production-go`, `sync-invariant-check`, `handle-personal-and-sensitive-data`, `make-apps-resilient-to-abuse-and-overload`, `meet-an-accessibility-baseline`, `review-before-shipping`.
No skill description was changed from this proxy alone. Description edits require model-trigger evidence on held-out prompts; the corpus is ready for that run when the Claude CLI is available.
