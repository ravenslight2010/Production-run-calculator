# Verified review defects — development verification

Initial scoped capture completed at 2026-10-03T22:07:32Z against base revision
`6a74526efac3119f5d21021b45617b70b3e8ba9b` plus the working-tree changes
described here. This is development/disposable-fixture evidence, not production
repair or release approval. No raw workbook, recipe, credential, authenticated
browser capture, or production record is retained in this report.

## Scope and result

- Factory purge retains QC history in both live and sandbox scopes. Its
  existing capability guard, transaction, reset epoch, broadcast, and other
  cleanup categories remain intact. Reset confirmation copy explains retention.
- Incomplete parsed profiles are excluded from writes with a review warning,
  rather than silently disappearing.
- Sauce/dough fuzzy grounding excludes unrelated flavor cells and headers,
  and tied candidates remain flagged rather than selecting the first.
  Exact-source and known names remain valid, including names without kind words.
- Brand/flavor fuzzy candidates exclude label/header cells; legitimate
  exact-source and known names are not excluded by the label filter.
- Sanitizer and merged-import warning limits retain a visible omitted count,
  including warnings without any matching profile row. Saved-review JSON
  round-trips retain that summary. Hidden counts represent warning occurrences,
  not a claim that unseen details were deduplicated across source files.
- Timer formatting rounds total seconds before dividing into hours/minutes.
- Shared parse version advances from 41 to 42. The version guard now understands
  the shared constant and historical client literals, and rejects unreadable
  target versions instead of silently skipping validation.
- The current deterministic corpus manifest's evaluator and lockfile hashes
  were refreshed from measured current inputs; corpus and source-evidence hashes
  and semantic snapshots remain unchanged.

## Passing checks

Commands use `bash scripts/src/run-release-node.sh` where Node is required.

| Check | Result |
| --- | --- |
| `pnpm --filter @workspace/spec-import run test` | PASS: 28 files, 343 tests |
| `pnpm --filter @workspace/corpus-harness run test` | PASS: 12 tests |
| API `sync.integration.test.ts`, `syncReset.integration.test.ts`, `sessionBoundary.integration.test.ts` | PASS: 164 tests, private temporary PostgreSQL cluster |
| API `aiParseSpecSheet.test.ts` | PASS: 47 tests; no paid provider calls |
| Client `fmtTime`, `fmtElapsed`, FactoryResetCard, SpecImportDialog warnings/steps/reuse | PASS: 6 files, 64 tests |
| Client specImport, incomplete-success, dough-name, sauce-name regressions | PASS: 4 files, 233 tests |
| Client saved-parse-reuse regressions | PASS, included in the initial focused 4-file/44-test pass |
| Distillation backfill/export CLI fixture tests | PASS: 2 Node test files |
| `pnpm run typecheck` | PASS, including library/artifact/script typechecks, generated-API checks, and recovery audit |
| Version-guard shell regressions | PASS: 7 cases, including shared-version and unreadable-version cases |
| Version guard on a temporary Git tree of the actual working changes | PASS: reads base 41 and target 42 |
| ShellCheck for changed guard/test scripts | PASS |
| `git diff --check` | PASS |
| Managed API and web workflow startup | PASS; API initialization reports ready |
| Public development landing screenshot | PASS at desktop 1280×720; expected unauthenticated 401s, no rendering crash |

The API fixtures create and migrate temporary databases inside a private local
cluster and stop/remove the cluster on exit. No purge test targets the application
development database or production database.

## Failure closure

| Initial observation | Closure |
| --- | --- |
| Focused DB setup timed out before tests ran | CLOSED: development DB service was not available in the pre-workflow shell; private disposable cluster completed the required integration suite |
| Three new sanitizer test failures | CLOSED: corrected expected existing warning wording and the known-dough fixture contract; full shared-library suite passes |
| New inventory fixture used string IDs and omitted required fields | CLOSED: fixture now uses generated integer IDs and explicit key/category; API suite and typecheck pass |
| Initial root typecheck reported the fixture type errors | CLOSED: final complete root typecheck passes |
| Corpus manifest identity mismatch | CLOSED: reviewed and refreshed measured evaluator/lockfile hashes; semantic corpus checks pass |
| Guard overlooked the shared version constant | CLOSED: compatible extraction and fail-closed behavior covered by isolated Git regression cases and the actual working-tree check |
| Task-board activation | CLOSED: the initial completion request was rejected while the record was MAIN_PENDING; the platform subsequently assigned the existing task as MAIN_IN_PROGRESS. Formal completion can now be submitted without rebuilding or repeating valid checks |

## Compatibility applicability

| Surface | Outcome and boundary |
| --- | --- |
| Desktop | PASS: rendered dialog/confirmation tests and public landing screenshot; authenticated browser import/purge flow NOT RUN, behavior covered by component and disposable API tests |
| Phone | NOT RUN in a real browser: no viewport-specific layout change; component text/interaction tests cover the changed UI behavior |
| Tablet portrait | NOT RUN: same bounded text/count change; existing responsive layout unchanged |
| Tablet landscape | NOT RUN: same bounded text/count change; existing responsive layout unchanged |
| Chromium/Chrome | PASS for public desktop startup capture only; authenticated browser flow NOT RUN, not implied by jsdom tests |
| WebKit/Safari | NOT RUN: no engine-specific feature was introduced; this report makes no WebKit regression-pass claim |
| Physical Android Chrome | NOT RUN: physical-device service not used; automated component tests are not device proof |
| Physical iOS Safari/PWA | NOT RUN: physical-device service not used; automated component tests are not device proof |
| Native mobile | NOT APPLICABLE: web-only product |

## Data, authorization, and retained evidence boundaries

No schema change, new HTTP field, production write, purge of application data,
historical recipe repair, prompt/model change, training run, or publish occurred.
Unknown persisted historical mislinks are not claimed repaired by these changes.
No aliases are learned from the newly rejected fuzzy candidates.

The historical backfill decision remains immutable at parse version 41 and
NO-GO. The current runtime exports version 42, so the old decision cannot authorize
this pipeline: the identity mismatch remains fail-closed. Updating that decision
requires a separately reviewed current-version decision, not retagging old
evaluation results. Prompt hash pins are unchanged.

Streamed published-app logs still showed background database-acquisition failures.
These are a nonblocking, explicitly excluded production-diagnosis observation:
no production root cause was investigated and this development verification
does not claim those failures are fixed. Full release gates and production
readiness were not assessed; this is not a recommendation to publish.

## Separately proposed follow-ups

The assigned-task closing flow proposed two independent, out-of-scope outcomes:
advisory plausibility review for extreme per-pizza amounts and a bounded
published-background-job database investigation. Neither proposal authorizes
execution, production mutation, or publishing; neither overlaps the active
package-refresh, Apply-source, retention, or QLoRA tasks.

Both proposals were read back as PROPOSED, with parent/category metadata intact.
Their stored dependency sets were then updated and verified to include the
current unfinished tasks #2648, #2650, #2651, #2652, #2653, #2654, #2655, #2656,
#2659, and this parent #2660. They therefore cannot start merely because this
parent completes. The proposal interface initially supplied only the parent
dependency; this later update is not proof of an atomic creation-time snapshot
or automatic acceptance-order enforcement. Earlier unapproved siblings were not
treated as accepted blockers. Recheck acceptance-order constraints before
accepting either suggestion.

## Subsequent completion-validation attempt

Formal completion was attempted after assignment. The platform launched the API
suite, full browser suite, standard/full release gates, audit, typecheck, and
other checks concurrently. Validation failed; the task is **not marked complete**.
The scoped passing results above are not a claim that this broader run passed.

| Observation | Current result and next action |
| --- | --- |
| Guard shell fixture failed from the scripts workspace | CLOSED: the isolated browser runner now resolves its repository from its own script path, not the caller's working directory. The existing fake-executable regression also runs from an unrelated temporary directory. Serial complete model/parse guard command and ShellCheck PASS |
| Typecheck and operational-policy checks could not spawn processes | CLOSED: both commands PASS when rerun serially after stopping the failed broad run |
| Production dependency audit initially aborted | FAIL: the serial audit runs but reports high-severity GHSA-vfj7-8cjw-p6xm in `braces` through API `http-proxy-middleware` → `micromatch`; it reports no patched version. No waiver, suppression, dependency swap, or security-pass claim was made. A supported remediation or explicit security-owner decision is still required |
| Broad API suite | FAIL: the run reported production-sandbox and cross-process sync failures and did not finish successfully. Concurrent resource pressure prevents treating this as clean regression evidence; no independent baseline was established. Diagnose/recheck affected failures serially rather than assuming they are pre-existing or all environmental |
| Full browser suite | FAIL: deliberately stopped after the broader run had already failed. Its output records 54 passed, 1 interrupted, and 115 not run; the retained passing duration report was not replaced. This is not a full Chromium or authenticated changed-flow pass |
| Standard/full release commands | BLOCKED for a valid retry: published-deployment identity and revision prerequisites were not supplied. The concurrent attempts failed, including a resource abort and an explicit missing-identity rejection. Do not invent identity or widen this task into production verification without authorization |
| Retained release evidence verification | FAIL: an incomplete release checkpoint is not retained passing evidence; the checker left the retained report unchanged. This bug-fix report does not repair or supersede release evidence |
| Formal task completion | BLOCKED: completion validation did not pass. No automatic validation bypass was used |

The bounded runner correction adds no package, credential, schema, production
operation, or application UI behavior. It keeps the existing isolated-database
and process-group cleanup safeguards. Remaining security/API validation blockers
and production-bound release prerequisites are reported explicitly, not converted
to passes by the earlier targeted results.