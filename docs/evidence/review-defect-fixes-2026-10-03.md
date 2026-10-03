# Verified review defects — development verification

Captured through 2026-10-03T22:07:32Z against base revision
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
| Task-board completion | BLOCKED: the live task record remains MAIN_PENDING with no dependencies, and completion was rejected because no main task is active. The implemented changes and checks are finished; task activation is still required before formal completion can be recorded |

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