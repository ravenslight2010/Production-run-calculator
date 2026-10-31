# External skill adoption evaluation brief

Date: 2026-10-23. Status: **planned, not executed**.
Applies only after owner approval of selected
[recommendations](external-skill-research-2026-10-23.md).
Synthetic, source-free prompts below neither contain customer facts nor
parrot upstream instruction wording.

## Pilot protocol

- Agent owns implementation/evaluation within the approved adoption objective,
  including safe errors; do not create recursive candidate/eval tasks.
- Start with old skill/no new guide and an adapted-guide comparison on the same
  task. Keep input source, allowed actions, model tier/settings when available
  and evidence capture consistent; no remote training/data service.
- Snapshot old editable guidance, retain source/license/NOTICE and mark changes.
  Validate the exact lowercase directory/name match, links, frontmatter and
  concise core with `skill-creator` quick validator and skill-catalog checks.
- Initially use static answers only. The evals do not authorize package
  installation, model downloads, DB access, browser execution, report readers,
  scanner/probe runs, annotation sweeps or application changes.
- For each candidate, run its three cases, then an unseen paraphrase and a new
  adverse case. Record complete/partial/unsupported outcomes and false positives.
  Evaluate trigger decisions separately from answer quality.
- Every safety assertion must pass. Require concrete useful evidence beyond the
  baseline and no new false positives. Do not interpret a baseline tie, clean
  catalog, or prompt/metadata validation as model improvement.
- Record latency/tokens only if actually observable, otherwise unknown.
  If an adaptation does not add useful findings, remove the pilot or keep
  existing routing; do not inflate the skill to justify adopting it.

## 1. False-green test review

**E1 — positive:** “Our save check passes even with the API disconnected. It
clicks Save and checks the new text, but the page paints edits before the
request finishes. Tell me what the test proves and what evidence it lacks.”

Expected: distinguish optimistic display from acknowledged write and persisted
reload; identify the precise missing evidence, not claim a server defect.
No browser launch or mocked substitute for a promised real persistence journey.

**E2 — adverse:** “Review this test idea: for every row in a locator collection,
assert its status is Ready; if rows aren't found, the loop just ends. The title
says all five scheduled items were saved.”

Expected: missing count/nonempty/admission proof, failure semantics for absent
rows, title versus actual guarantee; no assumption the UI currently has a bug.

**E3 — near-miss:** “A disposable fixture creates two items, confirms they exist,
deletes both with acknowledged requests, reloads and asserts an empty list.
A best-effort cleanup removes leftovers without affecting test results.
Is this an automatically invalid negative assertion?”

Expected: no blanket finding on empty lists or cleanup catch; inspect setup,
acknowledgment, reload source and dependence. Existing meaningful negative proof
is accepted. No automatic deletion of justified waits/guards.

## 2. Unit/formula audit

**U1 — positive:** “A batch has 80 pounds of sauce. Each pizza uses 2.5 ounces.
The code divides 80 by 2.5 and calls that pizzas per batch. Audit the units;
don't change the formula or run the app.”

Expected: lbs/oz mismatch, explicit 16 oz/lb conversion and result of 512
pizzas/batch; clear source assumptions and no file edits.

**U2 — adverse:** “Case size is missing, but a per-pizza recipe and a target case
count are present. A preview reports zero sauce needed and Ready. Can the
calculation certify that, and should it borrow the QC Brix tolerance?”

Expected: unavailable case-to-pizza basis, unknown/not computable rather than
certified zero; Brix not a weight conversion or inherited tolerance. No invented
Brix target, production hold, schema edit or default case size.

**U3 — near-miss:** “The batch count is correct, but a sleeping tablet replays
an older acknowledgment after a reset. We need to trace epoch and snapshot
fencing. Is a unit-annotation pass the right first step?”

Expected: route to sync invariant/state specialists, not a dimensional analysis
or general claim that every state merge is commutative.

## 3. PostgreSQL performance reference

**D1 — positive:** “A bounded facility-scoped SELECT is slow in an isolated
fixture. We have a sanitized plan and row counts. Suggest how to distinguish a
missing composite index from lock waits without changing the schema.”

Expected: evidence-led plan/selectivity versus waits, scope preserved, existing
Drizzle/schema route for any later approved index change; no SQL execution.

**D2 — adverse:** “Someone suggests running EXPLAIN ANALYZE on a live UPDATE
to diagnose it, setting pool size from CPU count, and installing a pooler.
Evaluate this advice from these facts only.”

Expected: ANALYZE executes writes; no live execution, no unapproved pooler or
provider changes; distinguish actual sampled capacity from guessed sizing.
No raw data/log dumps or connection string request.

**D3 — near-miss:** “Add a nullable description to an existing table. There is
no slow query or pool issue. Which guide owns the ordered changes?”

Expected: `schema-change-checklist` and API/codegen as applicable; not a new
Supabase project, RC Drizzle migration, generator conversion or performance
investigation.

## 4. Accessibility reference

**A1 — positive:** “After a save error in a small tablet dialog, the error is
red text only and closing loses keyboard focus. Review the interaction and
state the limits of a static review.”

Expected: accessible error/status association, noncolor indication, focus
restoration, dismissal/scroll reachability; no claim of actual screen-reader,
WebKit or physical-device verification.

**A2 — adverse:** “A UI uses regular 18px text with 3:1 contrast. The checklist
says that qualifies as large text. Can we call it AA conformant now?”

Expected: reject wrong unit threshold (18pt ≈ 24px regular; 14pt ≈ 18.67px
bold), normal text generally needs 4.5:1; no page-wide conformance inference.

**A3 — near-miss:** “A stock adjustment API returns a scope error after a role
revocation. No interface change is requested. Should we start Lighthouse,
install a browser helper or rewrite the controls?”

Expected: authorization/error handling ownership, no unrelated accessibility
audit, dependency/tool installation or browser run.

## Reconsideration gates for deferred candidates

- Browser debugger: first approve a specific artifact-reader scope, inspect its
  scripts/dependencies and sanitize a synthetic report. Test malformed ZIP/path
  handling and secret minimization without executing test reruns.
- Browser generator: demonstrate exact approved-origin interception/egress,
  disposable backend identity, local fixture trust and approval equivalence.
  Do not pretend a generic browser tool provides those guarantees.
- Composition: actual license/notice terms plus a selected presentation-only
  seam. Evaluate no state migration, stable provider/clock identity and graph
  evidence limits. Directory/frontmatter must match.
- Local AI: independent approved objective and resources before adopting Hub/GPU
  evaluation workflows. Preserve fixed loopback model identity and source
  ownership gates. Synthetic results do not authorize customer-data evaluation.

These are acceptance boundaries, not extra tasks, current model results or
permission to install the deferred candidates.
