# CodeRabbit review disposition: PRs 83–85

**Evidence provenance:** Captured 2026-10-01 (America/Chicago) in the Replit development workspace, against working tree base `ba460c96c9a4` with Task 2592 changes. API and browser tests used disposable local PostgreSQL and fixture data; production data was not used or changed. Verification was produced by the focused package tests, the root typecheck, and the isolated Playwright runner described below.

## Scope and result

This audit compares the review-only comments from [PR 84](https://github.com/ravenslight2010/Production-run-calculator/pull/84), [PR 85](https://github.com/ravenslight2010/Production-run-calculator/pull/85), and [PR 83](https://github.com/ravenslight2010/Production-run-calculator/pull/83) with the current working tree based on `ba460c96`. The PRs were not merged, and nothing was published or changed in production.

The inventories contain 44 distinct inline findings and 8 additional PR85 review-body fingerprints. Of the inline findings, 41 are fixed or already resolved; 3 are explicitly deferred or guarded pending evidence that is not available. Of the 8 fingerprints, 7 are fixed and 1 is deferred. Review summaries, scanner warnings, and metadata are separately classified below.

## Inline findings

| PR | Finding | Disposition and current evidence |
|---|---|---|
| 83 | `4110165807` | **Already resolved.** Browser guidance distinguishes the local web origin from the API origin in `.agents/memory/local-release-browser-fixture-base.md` and `.agents/memory/browser-e2e-local-origin.md`. |
| 83 | `4110165810` | **Fixed.** `manager-attention.spec.ts` declares the mix name inside the test and removes the out-of-scope module helpers. |
| 83 | `4110165822` | **Fixed.** The Prev transition now waits for the expected `runId` with `waitForCurrentRun` instead of a fixed 600 ms delay; covered by `mix-plan.spec.ts`. |
| 83 | `4110165825` | **Fixed.** Station-handoff fixtures require configured signup code and a validated loopback API origin. Coverage: `src/isolatedApiOrigin.test.ts` and `station-handoff-responsive.spec.ts`. |
| 83 | `4110165827` | **Fixed.** The isolation guard receives its required operation label in `station-handoff-responsive.spec.ts`. |
| 83 | `4110165831` | **Fixed.** The audit PDF test pins time, defines its expected range, and verifies both submitted dates in `AuditLogCard.test.tsx`. |
| 83 | `4110165833` | **Fixed.** Removed the invalid `aria-activedescendant` from the independently focused option buttons; `TouchOptionPicker.test.tsx` checks the chosen semantics. |
| 83 | `4110165834` | **Fixed.** Both mobile-query hooks fall back to legacy media-query listeners; `use-mobile.test.tsx` covers subscription, update, and cleanup. |
| 83 | `4110165839` | **Fixed as a documentation claim.** The migration note no longer calls the counts non-additive or claims zero unexplained drift. It states the 217 vs. 205 mismatch and the retained artifact’s 206 paths/unknown runner image. The underlying classification report is still missing. |
| 83 | `4110165842` | **Deferred.** Capture now fails closed without a runner image identity, and the missing-identity case is tested. The retained comparison still says `image: "unknown"`; it was not hand-edited or regenerated without an identifiable approved runner. |
| 83 | `4110165845` | **Fixed.** Duplicate reporter classifications were removed. `test:evaluation-report-retention` rejects duplicate classifications rather than masking them with a `Set`. |
| 84 | `4110168984` | **Already resolved.** The release-browser memory note refers to the shared contract instead of the stale test count. |
| 84 | `4110168992` | **Fixed.** Pool-timeout retry guidance now requires an idempotent/transactional whole pass and a durable lease; generic/provider timeouts remain final. |
| 84 | `4110168993` | **Fixed.** Background-operation tests use the production epoch through a test accessor rather than assuming startup age; covered by `backgroundOperations.integration.test.ts`. |
| 84 | `4110168998` | **Fixed.** Break schedules preserve omitted stored data and resolve timestamp conflicts; `protectRunValues.test.ts` covers omission, stale/equal/newer clocks, and reset cases. |
| 84 | `4110169001` | **Guard fixed; repair deferred.** The repair now compares current rows with audited before-images and aborts stale/unreviewed changes. Its integration test confirms the current plan contains one stale and three unreviewed rows and does not write a repair marker. Applying the repair remains blocked until complete approved before-images exist. |
| 84 | `4110169003` | **Fixed.** The auth test sends a bearer token and asserts the security-state lookup; covered by `requireAuth.test.ts`. |
| 84 | `4110169006` | **Already resolved.** Manual packaging edits update progress atomically in the sync transaction; coverage is in `protectRunValues.test.ts`. |
| 84 | `4110169011` | **Fixed.** Sauce seed logic is latched to the current run so decrementing to zero does not reseed. `sauceCarryoverSeed.test.ts` covers the same-run latch, zero-count decrement, run switch, and eligibility conditions. |
| 84 | `4110169018` | **Fixed; focused browser assertion passed.** `SummaryCard` is called as a render function, avoiding component remounts on timer updates. The isolated station-handoff test confirms an uncommitted Notes draft remains focused and intact across an active-run clock cadence; the wrapper's clean exit remains unconfirmed as recorded below. |
| 84 | `4110169020` | **Fixed.** The Warehouse source assertion uses Vite’s module-relative raw glob rather than `process.cwd()`. |
| 84 | `4110169026` | **Fixed.** Paused timeline completion is clamped to the current time; `dayTimeline.test.ts` covers a long-past pause. |
| 84 | `4110169031` | **Fixed.** Snapshot reads no longer mutate or notify on expiry, and snapshots are stable; covered by `manualSectionLocks.test.ts`. |
| 84 | `4110169035` | **Fixed.** Validation/auth failures are not retried; only documented retryable failures are. `operationalIntentOutbox.test.ts` covers 400/401/403/422/429/503 behavior. |
| 84 | `4110169036` | **Fixed.** The redundant permissive sync-frame schema branch is now `anyOf`; the generated API checks pass. |
| 84 | `4110169039` | **Fixed.** Auto-track uses the shared Frontline effective-batch-weight calculation instead of a duplicate cap. |
| 84 | `4110169042` | **Fixed.** Sync canonicalization uses locale-independent code-unit ordering; `sync-contract` now tests the serialized key order. |
| 84 | `4110169045` | **Fixed.** Applying a null delta map section deletes it; the builder/applier deletion round-trip is covered by `sync-contract`. |
| 84 | `4110169054` | **Deferred, non-runtime.** The flattened PgBouncer research excerpt needs regeneration with its source snapshot; it does not establish a product defect. |
| 84 | `4110169057` | **Fixed.** Malformed retained JSON now produces an evidence-path-specific error; release-evidence tests cover it. |
| 84 | `4110169063` | **Fixed.** Whitespace-only runner revision values fall back to `unbound` after trimming. |
| 85 | `4110167791` | **Fixed.** Manual resolution writes an explicit `status: resolved` audit marker, and refresh honors it. A new API integration regression resolves a derived incident, refreshes the queue, and verifies the item remains resolved. |
| 85 | `4110167794` | **Fixed.** Sign-out awaits session revocation and returns a logged 503 if revocation fails; the browser suite exercises successful sign-out. A forced rejection test was not found. |
| 85 | `4110167797` | **Fixed.** Import-operation fixtures use legacy test tokens with recorded sessions; the API integration suite passes. |
| 85 | `4110167798` | **Fixed.** Apply checks capabilities for every changed entity and undo checks normalized before/after snapshot entities. A new integration regression verifies cross-capability apply and undo are denied without writes. |
| 85 | `4110167813` | **Fixed.** Mix and surplus updates are scope-qualified; integration coverage verifies live/sandbox same-ID isolation. |
| 85 | `4110167816` | **Fixed.** Staff status and revoke actions enforce target privilege and final-manager protections; role integration coverage includes concurrent last-manager attempts. |
| 85 | `4110167819` | **Fixed.** Sync derived-map invalidation reads top-level `pepTypes`; integration coverage verifies propagation. |
| 85 | `4110167822` | **Fixed.** Factory reset audit entries include the authenticated actor; `syncReset.integration.test.ts` verifies it. |
| 85 | `4110167826` | **Fixed.** The destructive accessibility fixture requires a disposable database and uses facility-local dates. The focused browser suite exercises the accessibility spec against the wrapper-created disposable database. |
| 85 | `4110167830` | **Fixed.** Spec aliases are sanitized before the atomic request and the sanitized list drives persistence while correcting deletes are retained. |
| 85 | `4110167836` | **Fixed.** `commitSpecImport` returns the optional server `resultHash` used by guarded undo. The API import-operation tests exercise result-hash guarded undo; no dedicated client commit-return test was found. |
| 85 | `4110167839` | **Fixed.** Projection adoption compares before-values and preserves intervening browser edits; a new localStorage mutation regression passes. |
| 85 | `4110170378` | **Fixed.** Readiness recovery verification is recomputed from samples and published calls require release environment plus normal/recovery modes; forged, observe, and development cases are covered by release-evidence tests. |

## Additional PR85 review-body fingerprints

| Fingerprint | Disposition and evidence |
|---|---|
| `0681d04c3025da05db7b722a` | **Fixed.** Production refuses legacy test tokens; `auth.test.ts` covers the guard. |
| `0723bffed340ca799cb41467` | **Fixed.** The server-job absence query uses the exact submitted idempotency key; `serverJobs.integration.test.ts` covers the queue check. |
| `db738c386c44196f7c4f7c67` | **Fixed.** Both audit-export count assertions are awaited; included in the focused audit-export browser spec. |
| `6c09240695e3c74e86e99638` | **Fixed.** Audit PDF date inputs are pinned and asserted in `AuditLogCard.test.tsx`. |
| `b58837293f2a923e28c49218` | **Fixed.** Sync-convergence heartbeat is longer than the no-frame observation window; `sync.convergence.integration.test.ts` passes. |
| `6ed9535ea46322a7cb9232` | **Fixed.** Self-revoke is hidden and status/revoke errors are surfaced in `StaffRolesCard.tsx`. |
| `50b86e2b08e1efb5c35473` | **Fixed.** Responsive station spans use `sm:col-span-2` in `LiveRunTabContent.tsx`. |
| `4ae945621a39e67ab3c7098` | **Deferred / stale context.** The cited lines in the current release checker are source-library promotion logic, not the described fixture override. No change was made without current evidence. |

## Review summaries, outside-diff notes, and non-findings

### PR 83

- `5324555382` is an index of the 11 inline comments, not a separate defect.
- `5843053971` repeats inline findings `4110165810`, `4110165825`, and `4110165831`. Its broader test API/database-binding proposal is separate architecture scope; station fixtures now validate loopback API origin and use disposable DB guards.
- `5843019712` and `5843054705` are stack/auto-reply metadata, not findings. Refuted repair-fingerprint and Mix Plan assertions remain non-actionable.
- The generic docstring threshold, Betterleaks test-password literals, ast-grep test-harness heuristics, LanguageTool style items, and potential-spam flag did not establish another product defect. The docstring check was inconclusive; no blanket docstring work was added.

### PR 84

- `a6dc478b6afeb43b69cf722f` is **fixed**: the memory index now says facility rollover is server-owned and clients do not manufacture a local-midnight reset.
- `aa723f5de187ebfcb515a4b1` is **deferred** as a performance-only suggestion without profiling evidence.
- `4055c74d9a6c6f4e24ad74cb` is a **duplicate** of `4110169045`.
- `e53cde78d359929804ea7573` is **deferred** to a research-source registry refresh; it does not establish a runtime defect.
- The overall records `5324558923` / `5843052085` duplicate canonical findings. The same-epoch accepted-manual-edit receipt attribution concern is **deferred** for a dedicated receipt-provenance design and lost-acknowledgement test.
- Generic docstring coverage and the exhausted LanguageTool character budget are audit limitations, not product defects.

### PR 85

- `5324557775` is an index of the 13 inline findings and 8 fingerprints. `5843048878` aggregates canonical findings `4110167798`, `4110167816`, `4110167813`, and `4110167791`; it is not another defect.
- `5324560439`, `5843053896`, and `5843054575` are continuation/command/automated-reply metadata, not findings.
- The earlier CI notes are now covered by passing current checks: the nine-file API integration run passed 386 tests, including import-operation auth, sync integration and convergence, role authorization, and reset audit. Root typecheck passes, including the prior `TS7053` location. Audit PDF date assertions also pass in the client unit run.
- The incomplete CodeRabbit review of `home.tsx` remains an audit limitation, not evidence that the file is clean. Generic docstring coverage, exhausted LanguageTool budget, static-tool test-harness heuristics, and the SkillSpector warning did not establish a product defect.
- The release-fixture override note `4ae945621a39e67ab3c7098` remains deferred as described above; its cited current context does not match the review text.

## Verification and remaining risks

- API: nine focused integration files passed, 386 tests, on an ephemeral local PostgreSQL cluster. No shared or production database was used.
- Client/state/sync: focused safeguards passed (11 files/155 tests), sauce carryover plus auto-track tests (2 files/16 tests), and sync-contract tests (1 file/6 tests).
- Import: spec-import client tests passed (2 files/205 tests), the spec-import library suite passed (27 files/319 tests), and the corpus harness passed (12 tests).
- Scripts/release evidence: TypeScript 7 comparison tests passed (20); evaluation-retention tests passed (12) with privacy tests (4); release-evidence/WebKit/source-reconciliation/duration harness passed.
- Root typecheck passed after the final client change, including recovery audit (10 checks), generated API/Zod checks, and artifact typechecks. `git diff --check` passed.
- Earlier focused checks also passed: API unit tests (111), client suite (153), and API generated-contract checks.
- The initial five-spec isolated Playwright run (manager queue, mix plan, station handoff, accessibility isolation, audit export) produced 52 outcomes: 51 passed and one Mix Plan case failed because it referenced undeclared `runId1`. The fixture now reads the first run's persisted ID before creating the second; the targeted rerun passed in 59.7 seconds.
- Added and passed a focused SummaryCard browser regression in the isolated station-handoff suite: an uncommitted note on an active current run remained focused and intact beyond one active-run clock cadence. The displayed “Time Left” is an estimate, not a live countdown.
- The full five-spec set was not rerun after the targeted corrections. The full and targeted Playwright invocations printed their test results but remained alive afterward; I stopped only each test wrapper and removed only its disposable PostgreSQL cluster. The configured API workflow and shared/production databases were untouched, and no clean wrapper exit summary is available.
- The frontend preview loaded, but its `/me` request returned 502 while the configured API workflow was failed. I did not restart that workflow because its database target is not confirmed disposable; the isolated Playwright run uses a disposable database.
- `check:release-evidence` remains blocked by the existing unallowlisted `release-evidence/published-deployment-handoff.json`. The file was not removed or edited to manufacture a pass. The release-evidence test harness itself passes.

- The retained TypeScript 7 comparison is not usable as current reproducibility evidence until it is regenerated on an identifiable approved runner. The source-library reconciliation repair must remain unapplied until its before-image plan is complete and approved.
- A fresh CodeRabbit review of the resulting working tree is still required. No PR was merged and no deployment was made.

## Post-rebase verification (2026-10-01, America/Chicago)

The branch was rebased onto `main`. The four conflicts were resolved without leaving conflict markers. The sync route and integration test retain the top-level `pepTypes` dependency contract and combine the incoming full-shift fixture with the specific Pepperoni assertion of 125 lbs rather than 12.5 batches. The audit PDF test keeps its pinned date range and awaited object-URL revocation assertion. Browser-runner memory guidance preserves both process-cleanup and clean-wrapper-exit cautions.

Post-rebase checks passed:

- The focused sync SSE integration regression passed (1 passed, 129 skipped) against a fresh loopback-only temporary PostgreSQL cluster.
- `AuditLogCard.test.tsx` passed (3 tests).
- Root `pnpm run typecheck` passed, including the recovery audit and generated API checks.
- `git diff --check` passed, and the four resolved files contain no conflict markers.

The aggregate completion-validation attempt did not produce a clean result. The API-server test command exited 1 without test diagnostics. The security audit exited 134 without further details; the standard-release and browser commands also failed amid process/thread exhaustion (`Cannot fork`, `Resource temporarily unavailable`, and Node worker-thread creation failure). The release-evidence check remains blocked by the existing unallowlisted `release-evidence/published-deployment-handoff.json`. Full release mode declined to proceed without deployment identity arguments; those were not supplied because release readiness and publishing are out of scope. The completion-validation status then became unavailable after a service disconnect, so these aggregate checks are not claimed as passing.

The five-spec browser set was not rerun after the targeted fixes. A fresh CodeRabbit review is still required. No review PR was merged, nothing was published, and no production data was changed.