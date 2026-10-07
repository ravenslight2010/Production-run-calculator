# Gemini Skill-Trigger Near-Miss Review — October 7, 2026

## Scope and evidence

This is a manual review of the eight near-miss labels in
`skill-trigger-benchmark.json` against the current skill descriptions and
instructions. The task-referenced files
`tmp/gemini-skill-trigger-live-2026-10-07/review-queue.json` and
`results.json` were not present, so the October 7 provider decisions could not
be independently inspected. The checked-in root Gemini artifacts identify
themselves as sanitized historical evidence from September 3, 2026; they are
not treated as the October 7 run.

The task reports these eight cases as Gemini triggers. That report is not
evidence of Replit Agent behavior. No provider calls were made, and no missing
provider decisions were inferred or reconstructed.

## Findings

| Case | Expected label | Review |
| --- | --- | --- |
| `customer-import-audit-near-miss-1` | Do not trigger | Keep. The request is to trace an Excel parser's wrong-flavor link and repair poisoned records. That is import-bug investigation/data healing, not the read-only audit of a new customer's completed workbook. |
| `db-schema-change-near-miss-1` | Do not trigger | Keep. The request explicitly uses the detailed checklist for adding a field to an existing table; that procedure belongs to `schema-change-checklist`. Clarified `db-schema-change` to route other schema work and send existing-table fields directly to the specialist. |
| `evidence-hygiene-near-miss-1` | Do not trigger | Keep. Asking to run the release checklist and assess publish readiness does not itself ask to capture, sanitize, label, store, or review sensitive operational evidence. |
| `release-checklist-near-miss-1` | Do not trigger | Keep. A final production GO/NO-GO decision belongs to `production-go`; `release-checklist` supplies pre-publish evidence and does not make that decision. |
| `spec-import-guard-near-miss-1` | Do not trigger | Keep. Tracing what an already-imported workbook wrote to the database is an import investigation, not a request to modify the spec-import pipeline covered by this guard. |
| `state-accuracy-check-near-miss-2` | Do not trigger | Keep. Auditing merge stamps and stale writes across devices is sync transport/persistence work owned by `sync-invariant-check`, not timer/counter/live-form accuracy. |
| `verify-before-commit-near-miss-1` | Do not trigger | Keep. The request names the full pre-publish checklist and a production readiness decision, not local verification before a commit or push. Clarified that release gates and final GO/NO-GO decisions belong to `release-checklist` and `production-go`. |
| `wrong-number-triage-near-miss-2` | Do not trigger | Keep. Incorrect values across stored profiles call for import investigation/data healing; the request does not report a specific wrong number displayed in the web app. |

## Changes and limits

- The eight expected labels remain unchanged.
- Clarified the schema-change router and local pre-commit verification
  boundaries in their skill descriptions/instructions.
- Refreshed the checked-in offline benchmark metadata from the current skill
  descriptions. This does not rerun or update any provider result.
- The missing October 7 queue/results prevent a case-by-case confirmation of
  that run's exact decisions, confidence, and errors. The label review above is
  based on the checked-in source prompts and current skill boundaries only.
