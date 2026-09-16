# Skill trigger benchmark

- Skills: **31**
- Coverage: **26** project-owned, **5** managed curated fixtures
- Prompts: **124** (62 should-trigger, 62 near-miss should-not-trigger)
- Catalog validation: **PASS** (every prompt targets an available skill; managed fixtures are intentional and documented)
- Runtime model rates: **blocked** (the complete 124-prompt run and balanced held-out run were attempted with three repetitions, but every subprocess failed because `claude` is unavailable)

## Runtime attempt

The runtime attempt targeted this 124-prompt corpus: 124 prompts × 3 repetitions (372 attempts). A deterministic balanced held-out split (one positive and one near-miss per skill) was also exercised: 62 prompts × 3 repetitions (186 attempts). Every attempt failed before model evaluation with `[Errno 2] No such file or directory: 'claude'`.

Because `run_eval.py` records failed subprocesses as non-triggers, its resulting 0/3 rates are synthetic failure output, not model observations. Precision, recall, false-positive, and false-negative rates are therefore **unavailable** for every skill.

## Preflight findings

These are lexical review signals only, not claims that Claude would trigger. When the Claude CLI is available, rerun `run_eval.py` with three runs per prompt and this balanced held-out split before changing any description.

The nine previously flagged skills were reviewed individually. Seven positive cases used weak wording, two cases were overly close near misses, and the two sync positives shared a folded-frontmatter parser defect. Only the affected prompts and parser were refined; no skill description changed without model evidence.

| Skill | Case | Diagnosis | Original lexical evidence | Evidence-backed refinement |
| --- | --- | --- | --- | --- |
| `customer-import-audit` | `customer-import-audit-trigger-2` | weak positive wording | positive overlap 1: brand | State the post-import audit and customer-workbook boundary explicitly. |
| `db-schema-change` | `db-schema-change-trigger-2` | weak positive wording | positive overlap 1: column | Name the Drizzle/Postgres schema-migration work instead of relying on the word column. |
| `error-handling` | `error-handling-near-miss-2` | overly close near miss | negative overlap 5: behavior, error, failure, recovery, typescript | Keep the component boundary but remove explicit failure and recovery language from a non-error task. |
| `production-go` | `production-go-near-miss-1` | overly close near miss | negative overlap 5: before, checklist, decide, run, whether | Separate evidence gathering from the explicitly excluded release decision. |
| `sync-invariant-check` | `sync-invariant-check-trigger-1, sync-invariant-check-trigger-2` | folded-description parser defect | positive overlaps 0, 0 because description parsed as > | Parse folded YAML frontmatter so the full trigger description reaches preflight. |
| `ad-creative` | `ad-creative-trigger-1, ad-creative-trigger-2` | weak positive wording | positive overlaps 1, 1: static; display | Use the static ad-creative and advertising-campaign boundary terms in both positives. |
| `deep-research` | `deep-research-trigger-2` | weak positive wording | positive overlap 1: research | Make multi-source research, source scoring, and structured reporting explicit. |
| `design-thinker` | `design-thinker-trigger-2` | weak positive wording | positive overlap 0 | Name design thinking, audience definition, validation, and prioritization. |
| `recipe-creator` | `recipe-creator-trigger-2` | weak positive wording | positive overlap 0 | State recipe creation, ingredients, and substitutions rather than relying on cookable. |

## Per-skill runtime metrics

Runtime precision, recall, false-positive rate, and false-negative rate are **unavailable** for every skill because all attempts failed before model evaluation. The evaluator's 0/3 output is synthetic and is not included as evidence.

| Skill | Precision | Recall | False-positive rate | False-negative rate | Signals |
| --- | --- | --- | --- | --- | --- |
| `api-design` | N/A | N/A | N/A | N/A | none |
| `brainstorming` | N/A | N/A | N/A | N/A | none |
| `ci-security-review` | N/A | N/A | N/A | N/A | none |
| `customer-import-audit` | N/A | N/A | N/A | N/A | none |
| `data-cleanup` | N/A | N/A | N/A | N/A | none |
| `data-heal-playbook` | N/A | N/A | N/A | N/A | none |
| `db-schema-change` | N/A | N/A | N/A | N/A | none |
| `documentation-claim-review` | N/A | N/A | N/A | N/A | none |
| `error-handling` | N/A | N/A | N/A | N/A | none |
| `evidence-hygiene` | N/A | N/A | N/A | N/A | none |
| `external-skill-import` | N/A | N/A | N/A | N/A | none |
| `import-bug-investigation` | N/A | N/A | N/A | N/A | none |
| `operational-browser-verification` | N/A | N/A | N/A | N/A | none |
| `production-go` | N/A | N/A | N/A | N/A | none |
| `property-based-testing` | N/A | N/A | N/A | N/A | none |
| `release-checklist` | N/A | N/A | N/A | N/A | none |
| `rollback-recovery` | N/A | N/A | N/A | N/A | none |
| `schema-change-checklist` | N/A | N/A | N/A | N/A | none |
| `skill-creator` | N/A | N/A | N/A | N/A | none |
| `spec-import-guard` | N/A | N/A | N/A | N/A | none |
| `state-accuracy-check` | N/A | N/A | N/A | N/A | none |
| `sync-invariant-check` | N/A | N/A | N/A | N/A | none |
| `test-gap-triage` | N/A | N/A | N/A | N/A | none |
| `verify-before-commit` | N/A | N/A | N/A | N/A | none |
| `writing-quality-editor` | N/A | N/A | N/A | N/A | none |
| `wrong-number-triage` | N/A | N/A | N/A | N/A | none |
| `ad-creative` | N/A | N/A | N/A | N/A | none |
| `deep-research` | N/A | N/A | N/A | N/A | none |
| `design-thinker` | N/A | N/A | N/A | N/A | none |
| `recipe-creator` | N/A | N/A | N/A | N/A | none |
| `seo-auditor` | N/A | N/A | N/A | N/A | none |

## Interpretation

The refined preflight surfaced 0 skills for further review.
No skill description was changed: the runtime attempt produced no model-trigger evidence. Lexical results remain review signals only and must not be converted into description edits until an explicitly opted-in held-out model run succeeds.
