# Editable skills trigger benchmark

- Skills: **28**
- Prompts: **112** (56 should-trigger, 56 near-miss should-not-trigger)
- Runtime model rates: **blocked** (the complete 100-prompt run and balanced 40% held-out run were attempted with three repetitions, but every subprocess failed because `claude` is unavailable)

## Runtime attempt

The prior Claude evaluator attempt covered the former 25-skill corpus: 100 prompts × 3 repetitions (300 attempts). A deterministic balanced 40% held-out split (one positive and one near-miss per skill) was also exercised: 50 prompts × 3 repetitions (150 attempts). Every attempt failed before model evaluation with `[Errno 2] No such file or directory: 'claude'`.

Because `run_eval.py` records failed subprocesses as non-triggers, its resulting 0/3 rates are synthetic failure output, not model observations. Precision, recall, false-positive, and false-negative rates are therefore **unavailable** for every skill.

## Preflight findings

These are lexical review signals only, not claims that Claude would trigger. When the Claude CLI is available, rerun `run_eval.py` with three runs per prompt and this balanced 40% held-out split before changing any description.

## Per-skill runtime metrics

Runtime precision, recall, false-positive rate, and false-negative rate are **unavailable** for every skill because all attempts failed before model evaluation. The evaluator's 0/3 output is synthetic and is not included as evidence.

| Skill | Precision | Recall | False-positive rate | False-negative rate | Signals |
| --- | --- | --- | --- | --- | --- |
| `brainstorming` | N/A | N/A | N/A | N/A | none |
| `customer-import-audit` | N/A | N/A | N/A | N/A | under-trigger candidate (1) |
| `data-heal-playbook` | N/A | N/A | N/A | N/A | none |
| `db-schema-change` | N/A | N/A | N/A | N/A | under-trigger candidate (1) |
| `external-skill-import` | N/A | N/A | N/A | N/A | none |
| `import-bug-investigation` | N/A | N/A | N/A | N/A | none |
| `operational-browser-verification` | N/A | N/A | N/A | N/A | none |
| `production-go` | N/A | N/A | N/A | N/A | over-trigger candidate (1) |
| `release-checklist` | N/A | N/A | N/A | N/A | none |
| `rollback-recovery` | N/A | N/A | N/A | N/A | none |
| `schema-change-checklist` | N/A | N/A | N/A | N/A | none |
| `skill-creator` | N/A | N/A | N/A | N/A | none |
| `spec-import-guard` | N/A | N/A | N/A | N/A | none |
| `state-accuracy-check` | N/A | N/A | N/A | N/A | none |
| `sync-invariant-check` | N/A | N/A | N/A | N/A | under-trigger candidate (2) |
| `test-gap-triage` | N/A | N/A | N/A | N/A | none |
| `verify-before-commit` | N/A | N/A | N/A | N/A | none |
| `wrong-number-triage` | N/A | N/A | N/A | N/A | none |
| `check-dependency-licenses` | N/A | N/A | N/A | N/A | none |
| `handle-personal-and-sensitive-data` | N/A | N/A | N/A | N/A | under-trigger candidate (1) |
| `instrument-observability-and-graceful-errors` | N/A | N/A | N/A | N/A | none |
| `make-apps-resilient-to-abuse-and-overload` | N/A | N/A | N/A | N/A | under-trigger candidate (1) |
| `make-ui-responsive-across-devices` | N/A | N/A | N/A | N/A | none |
| `meet-an-accessibility-baseline` | N/A | N/A | N/A | N/A | under-trigger candidate (2) |
| `review-before-shipping` | N/A | N/A | N/A | N/A | under-trigger candidate (2) |
| `secure-ai-features-against-prompt-injection` | N/A | N/A | N/A | N/A | none |
| `validate-and-encode-untrusted-input` | N/A | N/A | N/A | N/A | none |
| `vet-dependencies-before-adding` | N/A | N/A | N/A | N/A | none |

## Interpretation

The preflight surfaced 8 skills for review: `customer-import-audit`, `db-schema-change`, `production-go`, `sync-invariant-check`, `handle-personal-and-sensitive-data`, `make-apps-resilient-to-abuse-and-overload`, `meet-an-accessibility-baseline`, `review-before-shipping`.
No skill description was changed: the runtime attempt produced no model-trigger evidence. The lexical flags remain review signals only and must not be converted into description edits until the held-out model run succeeds.
